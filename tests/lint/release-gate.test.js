// tests/lint/release-gate.test.js
//
// #186: auto-tag.yml does not wait for test.yml, so the tag for a merge can
// land while the post-merge main run is still going, or after it failed. PR
// checks are required since #249, but they prove the PR, not the tag; the
// enforcing run for a release is release.yml: a `verify` job runs the suite
// and the packed-tarball smoke on the same Node matrix test.yml proves, and
// both `publish-npm` and the GitHub Release wait on it. This guard fails the
// build if that matrix drifts from test.yml, or if the ordering is quietly
// undone.
const { loadWorkflow, runs, findStep, asList } = require('./workflow-guard');

// The suite command test.yml's test job runs — the literal, not a synonym:
// `npm test` and `npm run test:all` were both `jest` only by coincidence when
// #186 landed, and the enforcing run must copy the proving run's command, not
// a script that happens to expand to the same thing today.
const TEST = 'npm run test:all';
const SMOKE = './scripts/pack-smoke.sh';

// `always()` is load-bearing: on rc tags publish-npm is skipped, and without it
// a skipped dependency would skip the Release too. On graduated tags publish
// can only be skipped by the rc guard (pinned below), so `skipped` never lets
// an unpublished version through.
const RELEASE_IF =
  "always() && github.event_name != 'release' && needs.verify.result == 'success'" +
  " && (needs.publish-npm.result == 'success' || needs.publish-npm.result == 'skipped')";

// The only condition under which `needs.publish-npm.result == 'skipped'` in
// RELEASE_IF is safe: this guard skips publish for rc versions alone.
const RC_GUARD = "${{ !contains(needs.resolve.outputs.version, '-') }}";

const release = () => loadWorkflow('.github/workflows/release.yml').jobs;
const testJobs = loadWorkflow('.github/workflows/test.yml').jobs;

describe('release gate wiring (#186)', () => {
  // Every job, not just `test`: test.yml states the matrix twice (test and
  // pack-smoke) and nothing else pins those two equal — the Node guard only
  // checks both against the engines floor. Pinning verify against each job
  // transitively pins test.yml's internal restatement too.
  describe('verify matches every test.yml matrix', () => {
    test.each(Object.keys(testJobs))('%s: same node-version matrix as verify', (job) => {
      const verify = release().verify;
      expect(verify).toBeDefined();
      expect(verify.strategy.matrix['node-version']).toEqual(
        testJobs[job].strategy.matrix['node-version'],
      );
    });
  });

  test('verify does not fail fast and sets up the matrix Node', () => {
    const verify = release().verify;
    expect(verify.strategy['fail-fast']).toBe(false);
    const setup = verify.steps.find((s) => (s.uses || '').startsWith('actions/setup-node'));
    expect(setup).toBeDefined();
    expect(setup.with['node-version']).toBe('${{ matrix.node-version }}');
  });

  test('verify runs the same suite command as test.yml, then the pack smoke', () => {
    const prove = runs(testJobs.test.steps);
    expect(prove.indexOf('npm ci')).toBeGreaterThan(-1);
    expect(prove.indexOf(TEST)).toBeGreaterThan(prove.indexOf('npm ci'));

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

  // Not for outputs, for the skip: without `needs: resolve` a rejected manual
  // ref would let verify pass, skip publish-npm (its implicit success() fails
  // on the resolve failure), and the release job's `skipped` clause would
  // then run it with an empty tag. The needs line is what keeps the bad-ref
  // path dead.
  test('verify needs resolve', () => {
    expect(asList(release().verify.needs)).toContain('resolve');
  });

  test('publish-npm needs verify', () => {
    expect(asList(release()['publish-npm'].needs)).toContain('verify');
  });

  // The `|| needs.publish-npm.result == 'skipped'` clause in the release job's
  // if is only sound while this exact guard is the ONLY thing that can skip
  // publish on a graduated tag. supply-chain-gate.test.js pins it for the
  // audit gate; it is pinned here again because RELEASE_IF depends on it.
  test('publish-npm can only be skipped by the rc-tag guard', () => {
    expect(release()['publish-npm'].if).toBe(RC_GUARD);
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
