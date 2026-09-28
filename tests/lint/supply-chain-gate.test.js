// tests/lint/supply-chain-gate.test.js
//
// #161: the audit gate and Dependabot are only worth anything while they stay
// wired in. This guard fails the build if either is quietly removed.
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const root = path.join(__dirname, '..', '..');
const load = (rel) => yaml.load(fs.readFileSync(path.join(root, rel), 'utf8'));
const GATE = 'node scripts/audit-gate.js';
const runs = (steps) => steps.map((s) => s.run || '');

// A step with `continue-on-error: true` or an `if:` condition can pass the
// "is the gate present" checks above while never actually enforcing anything
// — the step either never fails the job or never runs. Find the gate step
// itself and assert neither escape hatch is set.
function findGateStep(steps) {
  const step = steps.find((s) => s.run === GATE);
  if (!step) throw new Error(`no step with run: "${GATE}" found`);
  return step;
}

describe('supply-chain gate wiring (#161)', () => {
  test('audit.yml runs the gate on PRs, pushes to main, and a schedule', () => {
    const wf = load('.github/workflows/audit.yml');
    // js-yaml parses the bare `on` key as boolean true.
    const on = wf.on || wf[true];
    expect(on).toHaveProperty('pull_request');
    expect(on).toHaveProperty('push');
    expect(on).toHaveProperty('schedule');
    const steps = Object.values(wf.jobs).flatMap((j) => j.steps);
    expect(runs(steps)).toContain(GATE);
  });

  test('audit.yml gate step is not neutralised by continue-on-error or if', () => {
    const wf = load('.github/workflows/audit.yml');
    const steps = Object.values(wf.jobs).flatMap((j) => j.steps);
    const gateStep = findGateStep(steps);
    expect(gateStep['continue-on-error']).toBeUndefined();
    expect(gateStep.if).toBeUndefined();
  });

  test('publish-npm runs the gate before npm publish', () => {
    const steps = load('.github/workflows/release.yml').jobs['publish-npm'].steps;
    const r = runs(steps);
    const gate = r.indexOf(GATE);
    const publish = r.findIndex((cmd) => cmd.startsWith('npm publish'));
    expect(gate).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(gate);
  });

  test('publish-npm gate step is not neutralised by continue-on-error or if', () => {
    const steps = load('.github/workflows/release.yml').jobs['publish-npm'].steps;
    const gateStep = findGateStep(steps);
    expect(gateStep['continue-on-error']).toBeUndefined();
    expect(gateStep.if).toBeUndefined();
  });

  test('dependabot covers npm (lockfile-only) and github-actions', () => {
    const { updates } = load('.github/dependabot.yml');
    const npm = updates.find((u) => u['package-ecosystem'] === 'npm');
    expect(npm).toBeDefined();
    expect(npm.directory).toBe('/');
    // lockfile-only keeps Dependabot PRs out of the version-bump gate, which
    // fails any PR touching package.json without a version bump.
    expect(npm['versioning-strategy']).toBe('lockfile-only');
    expect(updates.some((u) => u['package-ecosystem'] === 'github-actions')).toBe(true);
  });
});
