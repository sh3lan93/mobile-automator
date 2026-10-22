// tests/lint/supply-chain-gate.test.js
//
// #161: the audit gate and Dependabot are only worth anything while they stay
// wired in. This guard fails the build if either is quietly removed.
const { loadWorkflow, runs, findStep, findJobWithRun } = require('./workflow-guard');

const GATE = 'node scripts/audit-gate.js';

describe('supply-chain gate wiring (#161)', () => {
  test('audit.yml runs the gate on PRs, pushes to main, and a schedule', () => {
    const wf = loadWorkflow('.github/workflows/audit.yml');
    const on = wf.on;
    expect(on).toHaveProperty('pull_request');
    expect(on).toHaveProperty('push');
    expect(on).toHaveProperty('schedule');
    const steps = Object.values(wf.jobs).flatMap((j) => j.steps);
    expect(runs(steps)).toContain(GATE);
  });

  test('audit.yml gate step is not neutralised by continue-on-error or if', () => {
    const wf = loadWorkflow('.github/workflows/audit.yml');
    const steps = Object.values(wf.jobs).flatMap((j) => j.steps);
    const gateStep = findStep(steps, GATE);
    expect(gateStep['continue-on-error']).toBeUndefined();
    expect(gateStep.if).toBeUndefined();
  });

  test('audit.yml gate job is not neutralised by continue-on-error or if', () => {
    const wf = loadWorkflow('.github/workflows/audit.yml');
    const gateJob = findJobWithRun(wf.jobs, GATE);
    expect(gateJob['continue-on-error']).toBeUndefined();
    expect(gateJob.if).toBeUndefined();
  });

  test('publish-npm runs the gate before npm publish', () => {
    const steps = loadWorkflow('.github/workflows/release.yml').jobs['publish-npm'].steps;
    const r = runs(steps);
    const gate = r.indexOf(GATE);
    const publish = r.findIndex((cmd) => cmd.startsWith('npm publish'));
    expect(gate).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(gate);
  });

  test('publish-npm gate step is not neutralised by continue-on-error or if', () => {
    const steps = loadWorkflow('.github/workflows/release.yml').jobs['publish-npm'].steps;
    const gateStep = findStep(steps, GATE);
    expect(gateStep['continue-on-error']).toBeUndefined();
    expect(gateStep.if).toBeUndefined();
  });

  test('publish-npm job is not neutralised by continue-on-error, and its if is exactly the rc-tag guard', () => {
    const jobs = loadWorkflow('.github/workflows/release.yml').jobs;
    const gateJob = findJobWithRun(jobs, GATE);
    expect(gateJob).toBe(jobs['publish-npm']);
    expect(gateJob['continue-on-error']).toBeUndefined();
    expect(gateJob.if).toBe("${{ !contains(needs.resolve.outputs.version, '-') }}");
  });

  test('dependabot covers npm (lockfile-only) and github-actions', () => {
    const { updates } = loadWorkflow('.github/dependabot.yml');
    const npm = updates.find((u) => u['package-ecosystem'] === 'npm');
    expect(npm).toBeDefined();
    expect(npm.directory).toBe('/');
    // lockfile-only keeps Dependabot PRs out of the version-bump gate, which
    // fails any PR touching package.json without a version bump.
    expect(npm['versioning-strategy']).toBe('lockfile-only');
    const actions = updates.find((u) => u['package-ecosystem'] === 'github-actions');
    expect(actions).toBeDefined();
    // Grouped, so action bumps never queue behind the open-PR limit.
    expect(actions.groups).toBeDefined();
  });
});
