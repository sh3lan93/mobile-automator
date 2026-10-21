// tests/lint/release-gate.test.js
//
// #186: no CI check is a gate. The ruleset has no required status checks and
// auto-tag.yml does not wait for test.yml, so the PR and main runs are signals.
// The enforcing run is release.yml: a `verify` job runs the suite and the
// packed-tarball smoke on the same Node matrix test.yml proves, and both
// `publish-npm` and the GitHub Release wait on it. This guard fails the build
// if that matrix drifts from test.yml, or if the ordering is quietly undone.
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { REPO_ROOT } = require('./docs-corpus');

const load = (rel) => yaml.load(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
const runs = (steps) => steps.map((s) => s.run || '');
const asList = (needs) => (Array.isArray(needs) ? needs : [needs]);

const TEST = 'npm test';
const SMOKE = './scripts/pack-smoke.sh';

// `always()` is load-bearing: on rc tags publish-npm is skipped, and without it
// a skipped dependency would skip the Release too. On graduated tags publish
// can only be skipped by the rc guard, so `skipped` never lets an unpublished
// version through.
const RELEASE_IF =
  "always() && github.event_name != 'release' && needs.verify.result == 'success'" +
  " && (needs.publish-npm.result == 'success' || needs.publish-npm.result == 'skipped')";

const release = () => load('.github/workflows/release.yml').jobs;

// Same escape hatches as supply-chain-gate.test.js: `continue-on-error: true`
// or an `if:` on a step, or on the job that owns it, lets the check be present
// while never failing the workflow.
function findStep(steps, run) {
  const step = steps.find((s) => s.run === run);
  if (!step) throw new Error(`no step with run: "${run}" found`);
  return step;
}

describe('release gate wiring (#186)', () => {
  test('release.yml verify runs the same Node matrix as test.yml', () => {
    const testMatrix = load('.github/workflows/test.yml').jobs.test.strategy.matrix['node-version'];
    const verify = release().verify;
    expect(verify).toBeDefined();
    expect(verify.strategy.matrix['node-version']).toEqual(testMatrix);
  });

  test('verify does not fail fast and sets up the matrix Node', () => {
    const verify = release().verify;
    expect(verify.strategy['fail-fast']).toBe(false);
    const setup = verify.steps.find((s) => (s.uses || '').startsWith('actions/setup-node'));
    expect(setup).toBeDefined();
    expect(setup.with['node-version']).toBe('${{ matrix.node-version }}');
  });

  test('verify runs npm test and the pack smoke after npm ci', () => {
    const r = runs(release().verify.steps);
    const ci = r.indexOf('npm ci');
    expect(ci).toBeGreaterThan(-1);
    expect(r.indexOf(TEST)).toBeGreaterThan(ci);
    expect(r.indexOf(SMOKE)).toBeGreaterThan(ci);
  });

  test('verify job and its test steps are not neutralised by continue-on-error or if', () => {
    const verify = release().verify;
    expect(verify['continue-on-error']).toBeUndefined();
    expect(verify.if).toBeUndefined();
    for (const run of [TEST, SMOKE]) {
      const step = findStep(verify.steps, run);
      expect(step['continue-on-error']).toBeUndefined();
      expect(step.if).toBeUndefined();
    }
  });

  test('publish-npm needs verify', () => {
    expect(asList(release()['publish-npm'].needs)).toContain('verify');
  });

  test('publish-npm still runs npm publish after npm ci', () => {
    const r = runs(release()['publish-npm'].steps);
    const ci = r.indexOf('npm ci');
    const publish = r.findIndex((cmd) => cmd.startsWith('npm publish'));
    expect(ci).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(ci);
  });

  // The Release body tells users to `npm i -g`, so it must not exist for a
  // version npm never received — that is how v0.27.0 got a Release.
  test('release needs verify and publish-npm, and its if is exactly the gate', () => {
    const job = release().release;
    const needs = asList(job.needs);
    expect(needs).toContain('verify');
    expect(needs).toContain('publish-npm');
    expect(job.if).toBe(RELEASE_IF);
    expect(job['continue-on-error']).toBeUndefined();
  });
});
