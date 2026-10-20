// tests/lint/eslint-gate.test.js
//
// #164: ESLint is only worth anything while it stays wired in. The repo has no
// required status checks, so the PR-side ESLint job is a signal; the run inside
// release.yml's publish-npm job is the real gate. This guard fails the build if
// the script, the type-aware async rules, or either CI run is quietly removed
// or neutralised.
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { REPO_ROOT } = require('./docs-corpus');

const load = (rel) => yaml.load(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
const LINT = 'npm run lint';
const runs = (steps) => steps.map((s) => s.run || '');

// The rules that are the point of #164. A downgrade to 'warn' or 'off' would
// keep `npm run lint` green while the daemon-crash class of bug slips through.
const ASYNC_RULES = [
  '@typescript-eslint/no-floating-promises',
  '@typescript-eslint/no-misused-promises',
];

// A rule is either a bare severity or `[severity, options]`.
const severity = (rule) => (Array.isArray(rule) ? rule[0] : rule);
const isError = (rule) => severity(rule) === 'error' || severity(rule) === 2;

// Same escape hatches as supply-chain-gate.test.js: `continue-on-error: true`
// or an `if:` on the step, or on the job that owns it, lets the lint run be
// present while never failing the workflow.
function findLintStep(steps) {
  const step = steps.find((s) => s.run === LINT);
  if (!step) throw new Error(`no step with run: "${LINT}" found`);
  return step;
}

function findLintJob(jobs) {
  const job = Object.values(jobs).find((j) => (j.steps || []).some((s) => s.run === LINT));
  if (!job) throw new Error(`no job with a step running "${LINT}" found`);
  return job;
}

describe('ESLint gate wiring (#164)', () => {
  test('package.json scripts.lint runs eslint', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    expect(typeof pkg.scripts.lint).toBe('string');
    expect(pkg.scripts.lint.startsWith('eslint')).toBe(true);
  });

  test.each(ASYNC_RULES)('eslint.config.js enables %s at error for src/**', (rule) => {
    const config = require(path.join(REPO_ROOT, 'eslint.config.js'));
    expect(Array.isArray(config)).toBe(true);
    const covering = config.filter(
      (entry) => (entry.files || []).some((glob) => glob.startsWith('src/**')),
    );
    expect(covering.some((entry) => entry.rules && isError(entry.rules[rule]))).toBe(true);
  });

  // lint.yml, not test.yml: node-version-agreement.test.js requires every
  // test.yml job to run the Node matrix, and one parse target needs one Node.
  test('lint.yml runs ESLint on PRs and pushes', () => {
    const wf = load('.github/workflows/lint.yml');
    expect(wf.on).toHaveProperty('pull_request');
    expect(wf.on).toHaveProperty('push');
    const steps = Object.values(wf.jobs).flatMap((j) => j.steps);
    expect(runs(steps)).toContain(LINT);
  });

  test('lint.yml lint step and job are not neutralised by continue-on-error or if', () => {
    const wf = load('.github/workflows/lint.yml');
    const lintStep = findLintStep(Object.values(wf.jobs).flatMap((j) => j.steps));
    expect(lintStep['continue-on-error']).toBeUndefined();
    expect(lintStep.if).toBeUndefined();
    const lintJob = findLintJob(wf.jobs);
    expect(lintJob['continue-on-error']).toBeUndefined();
    expect(lintJob.if).toBeUndefined();
  });

  test('publish-npm runs ESLint before npm publish', () => {
    const steps = load('.github/workflows/release.yml').jobs['publish-npm'].steps;
    const r = runs(steps);
    const lint = r.indexOf(LINT);
    const publish = r.findIndex((cmd) => cmd.startsWith('npm publish'));
    expect(lint).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(lint);
  });

  // The publish-npm job's own `if:` (the rc-tag guard) is pinned by
  // supply-chain-gate.test.js; only the step is checked here.
  test('publish-npm lint step is not neutralised by continue-on-error or if', () => {
    const steps = load('.github/workflows/release.yml').jobs['publish-npm'].steps;
    const lintStep = findLintStep(steps);
    expect(lintStep['continue-on-error']).toBeUndefined();
    expect(lintStep.if).toBeUndefined();
  });
});
