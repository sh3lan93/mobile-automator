'use strict';

// Structural guard: the Node support range is stated in eight places — the
// engines field, a README badge, four prose prerequisites, and the CI matrix.
// #162 happened because they were free to drift: CI verified only Node 18
// (EOL April 2025) while `engines` promised `>=18` to users running 22 and 24,
// and nothing failed. This guard derives the floor from package.json — the one
// declaration npm actually enforces — and fails any doc, workflow, or lockfile
// that disagrees.
//
// Excluded by design: CHANGELOG.md, docs/changelog.md and docs/plans/** are
// historical records. "Node 18" was TRUE when those were written.

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const pkg = require('../../package.json');
const lock = require('../../package-lock.json');

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

// --- Prose claim sites ------------------------------------------------------

// Anything shaped like a statement about the Node version a user needs.
// Each pattern captures the major version being claimed.
//
// `active: true` means this pattern is expected to match something in the
// current corpus — a real phrasing in use today — and the anti-vacuity test
// below fails if it ever stops matching (see #162 review finding "Minor 6").
// `active: false` marks a pattern kept purely defensively, for a realistic
// phrasing this repo does not currently use anywhere (e.g. an alternate
// shields.io badge encoding); it is still checked for floor violations, it
// just isn't required to have a live hit.
//
// Deliberately NOT matched: lowercase `node >= 18`. Matching it would also
// catch `"node": ">=20.0.0"` inside JSON snippets quoted in docs (e.g. a
// package.json excerpt), which is not a claim about what the *reader* needs —
// it would false-positive every time an example config is pasted in prose.
const CLAIM_PATTERNS = [
  {
    regex: /Node-%E2%89%A5(\d+)-/g,
    active: true,
    label: 'shields.io badge "Node-≥N-brightgreen"',
  },
  {
    regex: /Node-%3E%3D(\d+)-/g,
    active: false,
    label: 'shields.io badge using %3E%3D ("Node->=N") instead of %E2%89%A5 ("Node-≥N")',
  },
  {
    regex: /Node(?:\.js)?\s*(?:\*\*)?\s*[≥>]=?\s*(\d+)/g,
    active: true,
    label: '"Node ≥ N" / "Node.js ≥ N"',
  },
  {
    regex: /Node(?:\.js)?\*{0,2}\s+v?(\d+)\+/g,
    active: true,
    label: '"Node.js vN+"',
  },
  {
    regex: /Node(?:\.js)?\*{0,2}(?:\s+\S+){0,2}?\s+v?(\d+) or (?:higher|newer|later)/g,
    active: true,
    label: '"Node(.js) [is] vN or higher/newer/later" — anchored to Node so a claim like ' +
      '"scenario schema v2 or higher" cannot misfire',
  },
];

const EXCLUDED_FILES = new Set(['CHANGELOG.md', 'docs/changelog.md', 'CLAUDE.md']);
// .superpowers/sdd is gitignored task-planning scratch space — see
// .superpowers/sdd/.gitignore, which ignores everything under that exact
// path (`*`). It never reaches a real checkout, so a doc under it is
// neither shipped nor historical; it just doesn't exist in CI. Scoped to
// `sdd` specifically, not all of `.superpowers`, because that's the actual
// gitignore boundary — a tracked file added elsewhere under `.superpowers/`
// must still be scanned.
const EXCLUDED_DIRS = ['node_modules', '.git', 'docs/plans', 'sample-app', '.superpowers/sdd'];

function shippingMarkdown(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(REPO_ROOT, abs);
    if (EXCLUDED_DIRS.some((d) => rel === d || rel.startsWith(`${d}${path.sep}`))) continue;
    if (entry.isDirectory()) shippingMarkdown(abs, out);
    else if (entry.name.endsWith('.md') && !EXCLUDED_FILES.has(rel)) out.push(rel);
  }
  return out;
}

// --- Workflow helpers -------------------------------------------------------

const WORKFLOW_DIR = path.join(REPO_ROOT, '.github', 'workflows');

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
      const uses = step.uses || '';
      if (!uses.startsWith('actions/setup-node')) continue;
      found.push({ job: jobName, version: String((step.with || {})['node-version'] ?? '') });
    }
  }
  return found;
}

describe('Node support range — structural agreement', () => {
  test('every prose claim in shipping docs states the engines floor', () => {
    const violations = [];
    for (const rel of shippingMarkdown(REPO_ROOT)) {
      const text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      for (const { regex } of CLAIM_PATTERNS) {
        regex.lastIndex = 0;
        let m;
        while ((m = regex.exec(text)) !== null) {
          const claimed = Number(m[1]);
          if (claimed !== FLOOR) {
            violations.push({ file: rel, claimed, expected: FLOOR, text: m[0] });
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('every active claim pattern matches at least once, so the scan can never pass vacuously', () => {
    const corpus = shippingMarkdown(REPO_ROOT).map((rel) =>
      fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')
    );
    const deadPatterns = [];
    for (const { regex, active, label } of CLAIM_PATTERNS) {
      if (!active) continue; // defensive-only pattern — see comment above CLAIM_PATTERNS
      const matched = corpus.some((text) => {
        regex.lastIndex = 0;
        return regex.test(text);
      });
      if (!matched) deadPatterns.push(label);
    }
    expect(deadPatterns).toEqual([]);
  });

  test('test.yml runs every job under a node-version matrix whose minimum is the floor', () => {
    const wf = loadWorkflow('test.yml');
    const jobs = Object.entries(wf.jobs);
    expect(jobs.length).toBeGreaterThan(0);

    for (const [jobName, jobDef] of jobs) {
      const matrix = ((jobDef.strategy || {}).matrix || {})['node-version'];
      expect({ job: jobName, matrix }).toEqual({
        job: jobName,
        matrix: expect.arrayContaining([expect.anything()]),
      });
      // fail-fast must be off, or one dead version hides the others' results.
      expect({ job: jobName, failFast: (jobDef.strategy || {})['fail-fast'] }).toEqual({
        job: jobName,
        failFast: false,
      });
      const majors = matrix.map((v) => Number(String(v).split('.')[0]));
      expect({ job: jobName, min: Math.min(...majors) }).toEqual({ job: jobName, min: FLOOR });
      // A matrix with no setup-node step at all verifies nothing — the job
      // would run every leg on the runner's default Node while the check
      // name still claims to cover the matrix.
      const nodeSteps = setupNodeVersions({ jobs: { [jobName]: jobDef } });
      expect({ job: jobName, hasSetupNodeStep: nodeSteps.length > 0 }).toEqual({
        job: jobName,
        hasSetupNodeStep: true,
      });
      // Every setup-node step present must read the matrix, not a literal.
      for (const { job, version } of nodeSteps) {
        expect({ job, version }).toEqual({ job, version: '${{ matrix.node-version }}' });
      }
    }
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
          violations.push({ file, job, version, floor: FLOOR });
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('package-lock.json root entry agrees with package.json on version and engines.node', () => {
    const rootEntry = (lock.packages || {})[''];
    if (!rootEntry) {
      throw new Error(
        'package-lock.json has no packages[""] root entry to compare against package.json — ' +
          'was the lockfile regenerated with a pre-v7 npm, or hand-edited?'
      );
    }
    expect({
      version: rootEntry.version,
      enginesNode: (rootEntry.engines || {}).node,
    }).toEqual({
      version: pkg.version,
      enginesNode: ENGINES_RANGE,
    });
  });
});
