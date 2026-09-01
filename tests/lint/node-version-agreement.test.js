'use strict';

// Structural guard: the Node support range is stated in eight places — the
// engines field, a README badge, four prose prerequisites, and the CI matrix.
// #162 happened because they were free to drift: CI verified only Node 18
// (EOL April 2025) while `engines` promised `>=18` to users running 22 and 24,
// and nothing failed. This guard derives the floor from package.json — the one
// declaration npm actually enforces — and fails any doc or workflow that
// disagrees.
//
// Excluded by design: CHANGELOG.md, docs/changelog.md and docs/plans/** are
// historical records. "Node 18" was TRUE when those were written.

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const pkg = require('../../package.json');

// --- Derived truth (never hardcode this) ----------------------------------

const ENGINES_RANGE = pkg.engines.node;
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
const CLAIM_PATTERNS = [
  /Node-%E2%89%A5(\d+)-/g, // shields.io badge: "Node-≥18-brightgreen"
  /Node(?:\.js)?\s*(?:\*\*)?\s*[≥>]=?\s*(\d+)/g, // "Node ≥ 18", "Node.js ≥ 18"
  /Node(?:\.js)?\*{0,2}\s+v?(\d+)\+/g, // "Node.js v18+"
  /v(\d+) or higher/g, // "v18 or higher"
];

const EXCLUDED_FILES = new Set(['CHANGELOG.md', 'docs/changelog.md', 'CLAUDE.md']);
// .superpowers/sdd is gitignored task-planning scratch space (see
// .superpowers/sdd/.gitignore) — it never reaches a real checkout, so a doc
// under it is neither shipped nor historical; it just doesn't exist in CI.
const EXCLUDED_DIRS = ['node_modules', '.git', 'docs/plans', 'sample-app', '.superpowers'];

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
      for (const pattern of CLAIM_PATTERNS) {
        pattern.lastIndex = 0;
        let m;
        while ((m = pattern.exec(text)) !== null) {
          const claimed = Number(m[1]);
          if (claimed !== FLOOR) {
            violations.push({ file: rel, claimed, expected: FLOOR, text: m[0] });
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('at least one prose claim exists, so the scan can never pass vacuously', () => {
    const hits = shippingMarkdown(REPO_ROOT).filter((rel) => {
      const text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      return CLAIM_PATTERNS.some((p) => {
        p.lastIndex = 0;
        return p.test(text);
      });
    });
    expect(hits).toEqual(expect.arrayContaining(['README.md', 'CONTRIBUTING.md']));
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
      // Every setup-node in test.yml must read the matrix, not a literal.
      for (const { job, version } of setupNodeVersions({ jobs: { [jobName]: jobDef } })) {
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
});
