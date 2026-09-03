'use strict';

// Structural guard: mauto's supported Node range is claimed in prose (a README
// badge, the contributor prerequisites, the getting-started docs) and in the CI
// matrix, all free to drift from `engines.node` — the one declaration npm
// actually enforces. #162 is what that drift costs: CI verified only Node 18
// (EOL April 2025) while `engines` promised `>=18` to users running 22 and 24,
// and nothing failed. This guard derives the floor from `engines.node` and
// fails every site that disagrees with it.
//
// Two scope notes:
//   - `engines.node` must be a bare `>=X.Y.Z` floor. A range with no single
//     floor (`^20 || ^22`) has nothing to check prose against, so this guard
//     rejects it outright rather than guessing.
//   - The doc corpus, and which docs count as historical, come from
//     ./docs-corpus, shared with the other prose-scanning guards.
//   - The lockfile mirroring `engines.node` is asserted by
//     ./lockfile-in-sync.test.js, which owns that invariant for every field.

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { REPO_ROOT, shippingDocs } = require('./docs-corpus');
const pkg = require('../../package.json');

// --- Derived truth (never hardcode this) ----------------------------------

const ENGINES_RANGE = (pkg.engines || {}).node;
const FLOOR = (() => {
  const m = /^>=\s*(\d+)\.\d+\.\d+$/.exec(ENGINES_RANGE);
  if (!m) {
    throw new Error(
      `engines.node must be an exact ">=X.Y.Z" floor for this guard to derive a ` +
        `major from; got ${JSON.stringify(ENGINES_RANGE)}`
    );
  }
  return Number(m[1]);
})();

// --- Prose claims -----------------------------------------------------------

// One broad pattern, deliberately. An enumeration of known phrasings only
// protects the claim sites that already exist and silently ignores the next one
// somebody writes — "Install Node 18 first" and "Node.js 18 LTS or above" both
// walked straight past the enumerated version of this guard. Matching *any*
// Node-adjacent major and exempting the few known non-claims inverts the
// failure mode: over-matching is loud and costs one allowlist line, while
// under-matching is silent and permanent.
//
// The lookbehind keeps `v18.19.0` reading as 18 rather than as its minor, and
// the two-digit major keeps `mobile-mcp 0.0.55` and `setup-node@v4` out.
const NODE_CLAIM = /\bNode(?:\.?js)?\b[^\n]{0,24}?(?<![\w.])v?(\d{2})(?![\d])/gi;

// Lines that name a Node major without claiming what mauto supports.
const NOT_A_CLAIM = [
  // release.yml upgrades npm in-job; this sentence is about the npm version
  // Node 22 bundles, not about the range mauto runs on.
  /\bNode 22 ships 10\.x\b/,
];

// shields.io percent-encodes the comparison operator in badge URLs
// (`≥` → `%E2%89%A5`, `>=` → `%3E%3D`), and those escapes contain digits of
// their own — `%E2%89%A5` reads as version 89 if taken literally. Decoding
// first means one pattern covers every badge encoding instead of one pattern
// per encoding, most of which would never be exercised.
function decodePercentEscapes(line) {
  return line.replace(/(?:%[0-9A-Fa-f]{2})+/g, (seq) => {
    try {
      return decodeURIComponent(seq);
    } catch {
      return ' ';
    }
  });
}

/**
 * Every Node-version claim in a blob of markdown.
 *
 * `matchAll` clones the regex internally, so the shared `NODE_CLAIM` object
 * never carries `lastIndex` state between calls.
 *
 * @param {string} text
 * @returns {{line: number, claimed: number, text: string}[]}
 */
function nodeClaims(text) {
  const claims = [];
  text.split('\n').forEach((raw, i) => {
    const line = decodePercentEscapes(raw);
    if (NOT_A_CLAIM.some((re) => re.test(line))) return;
    for (const m of line.matchAll(NODE_CLAIM)) {
      claims.push({ line: i + 1, claimed: Number(m[1]), text: line.trim() });
    }
  });
  return claims;
}

// --- Workflow helpers -------------------------------------------------------

const WORKFLOW_DIR = path.join(REPO_ROOT, '.github', 'workflows');
const MATRIX_REF = '${{ matrix.node-version }}';

function loadWorkflow(name) {
  return yaml.load(fs.readFileSync(path.join(WORKFLOW_DIR, name), 'utf8'));
}

function workflowFiles() {
  return fs.readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
}

function setupNodeVersions(workflow) {
  const found = [];
  for (const [jobName, job] of Object.entries(workflow.jobs || {})) {
    for (const step of job.steps || []) {
      if (!(step.uses || '').startsWith('actions/setup-node')) continue;
      found.push({ job: jobName, version: String((step.with || {})['node-version'] ?? '') });
    }
  }
  return found;
}

describe('Node support range — structural agreement', () => {
  describe('the claim pattern', () => {
    // Every phrasing this repo has used, plus the ones that escaped the
    // enumerated guard this replaced. All must read as a claim of Node 18, so
    // that a floor of 20 rejects them.
    const CLAIMS = [
      'Node ≥ 18',
      'Node.js ≥ 18',
      '- **Node ≥ 18** - `mauto` is a Node CLI',
      '- **Node.js ≥ 18** — `mauto` is a Node CLI',
      '- ✅ **Node.js** v18+ (for the mobile-mcp automation engine)',
      '- **Node.js** v18 or higher (required for the automation engine)',
      'Ensure Node.js is v18 or newer: `node --version`',
      'Node.js 18 LTS or above',
      'Install Node 18 first.',
      '- Node: v18.19.0',
      "          node-version: '18'",
      '  "node": ">=18.0.0"',
      '[![Node](https://img.shields.io/badge/Node-%E2%89%A518-brightgreen.svg)](#)',
      '[![Node](https://img.shields.io/badge/Node-%3E%3D18-brightgreen.svg)](#)',
    ];
    test.each(CLAIMS)('reads %j as a claim of Node 18', (phrase) => {
      expect(nodeClaims(phrase).map((c) => c.claimed)).toEqual([18]);
    });

    const NON_CLAIMS = [
      'It upgrades npm in-job because trusted publishing needs npm >= 11.5.1 and Node 22 ships 10.x.',
      'scenario schema v2 or higher',
      'mobile-mcp is pinned at 0.0.55',
      'resolved from node_modules at runtime, 42 packages deep',
      '      - uses: actions/setup-node@v4',
    ];
    test.each(NON_CLAIMS)('ignores %j', (phrase) => {
      expect(nodeClaims(phrase)).toEqual([]);
    });
  });

  test('the README still yields a claim, so a broken pattern cannot pass vacuously', () => {
    const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
    expect(nodeClaims(readme).length).toBeGreaterThan(0);
  });

  test('every Node claim in shipping docs states the engines floor', () => {
    const violations = [];
    for (const rel of shippingDocs()) {
      const text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      for (const claim of nodeClaims(text)) {
        if (claim.claimed !== FLOOR) {
          violations.push(
            `${rel}:${claim.line}: says Node ${claim.claimed}, engines.node says ${FLOOR} — ${claim.text}`
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('test.yml runs every job under a node-version matrix whose minimum is the floor', () => {
    const jobs = Object.entries(loadWorkflow('test.yml').jobs || {});
    expect(jobs.length).toBeGreaterThan(0);

    // Collected rather than asserted inline: a job that fails must not hide the
    // next job's result, for the same reason the matrix sets fail-fast: false.
    const violations = [];
    for (const [job, def] of jobs) {
      const strategy = def.strategy || {};
      const matrix = (strategy.matrix || {})['node-version'];

      if (!Array.isArray(matrix) || matrix.length === 0) {
        violations.push(`${job}: has no strategy.matrix.node-version`);
      } else {
        const majors = matrix.map((v) => Number(String(v).split('.')[0]));
        if (!majors.every(Number.isFinite)) {
          violations.push(`${job}: matrix ${JSON.stringify(matrix)} has a non-numeric major`);
        } else if (Math.min(...majors) !== FLOOR) {
          violations.push(
            `${job}: matrix minimum is ${Math.min(...majors)}, engines.node floor is ${FLOOR}`
          );
        }
      }

      // fail-fast must be off, or one dead version hides the others' results.
      if (strategy['fail-fast'] !== false) {
        violations.push(
          `${job}: strategy.fail-fast must be false, got ${JSON.stringify(strategy['fail-fast'])}`
        );
      }

      // A job with no setup-node step verifies nothing: every leg would run on
      // the runner's default Node while the check name still claims the matrix.
      const steps = setupNodeVersions({ jobs: { [job]: def } });
      if (steps.length === 0) violations.push(`${job}: has no actions/setup-node step`);
      for (const { version } of steps) {
        if (version !== MATRIX_REF) {
          violations.push(`${job}: setup-node reads ${JSON.stringify(version)}, must read ${MATRIX_REF}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('every literal node-version across all workflows is at or above the floor', () => {
    const violations = [];
    for (const file of workflowFiles()) {
      const wf = loadWorkflow(file);
      if (!wf || typeof wf !== 'object' || !wf.jobs) continue;
      for (const { job, version } of setupNodeVersions(wf)) {
        if (version.includes('${{')) continue; // matrix reference, checked above
        const major = Number(version.split('.')[0]);
        if (!Number.isFinite(major) || major < FLOOR) {
          violations.push(`${file} (${job}): node-version ${JSON.stringify(version)} is below the floor ${FLOOR}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
