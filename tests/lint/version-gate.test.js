// tests/lint/version-gate.test.js
//
// #369: the version gate once checked only "is v<version> already tagged?",
// so 0.40.13 merged after v0.40.14 shipped and npm publish refused it. The
// ordering now lives in scripts/version-gate.js (on scripts/version-order.js)
// and runs twice: on the PR, and again in auto-tag.yml before the tag push,
// because a stale branch can merge with a PR run that predates the latest
// merge. This guard fails the build if either run is unwired or neutralised,
// and drives the gate's own decide() through the issue's cases.
const yaml = require('js-yaml');

const { loadWorkflow, runs, findStep, findJobWithRun } = require('./workflow-guard');

const { decide, SHIPPING_PATHS } = require('../../scripts/version-gate');

const PR_GATE = 'node scripts/version-gate.js "$VERSION" --mode pr';
const TAG_GATE = 'node scripts/version-gate.js "$VERSION" --mode tag';
const FETCH = 'git fetch --tags';

const neutralised = (x) => ({ if: x.if, 'continue-on-error': x['continue-on-error'] });
const CLEAN = { if: undefined, 'continue-on-error': undefined };

function checkoutOf(steps) {
  const checkout = steps.find((s) => typeof s.uses === 'string' && s.uses.startsWith('actions/checkout@'));
  if (!checkout) throw new Error('no actions/checkout step found');
  return checkout;
}

describe('version-check.yml runs the ordering gate on PRs (#369)', () => {
  const wf = loadWorkflow('.github/workflows/version-check.yml');
  const job = wf.jobs['check-version'];

  test('check-version runs the gate in pr mode, after fetching tags', () => {
    expect(findJobWithRun(wf.jobs, PR_GATE)).toBe(job);
    const r = runs(job.steps);
    expect(r.indexOf(FETCH)).toBeGreaterThan(-1);
    expect(r.indexOf(PR_GATE)).toBeGreaterThan(r.indexOf(FETCH));
  });

  test('the gate reads the version from package.json via env', () => {
    expect(findStep(job.steps, PR_GATE).env).toEqual({ VERSION: '${{ steps.get_version.outputs.version }}' });
  });

  test('the gate step is not neutralised by if: or continue-on-error', () => {
    expect(neutralised(findStep(job.steps, PR_GATE))).toEqual(CLEAN);
    expect(job['continue-on-error']).toBeUndefined();
    // The job's one if: is the "no CLI change, no bump" skip that
    // required-checks.test.js pins exactly; nothing else may gate it.
  });

  test('its checkout fetches full history and tags', () => {
    expect(checkoutOf(job.steps).with['fetch-depth']).toBe(0);
  });
});

// Tag mode skips an already-tagged version only when nothing under the
// shipping paths changed since that tag; those paths must be exactly the
// ones the PR gate treats as shipping CLI code, or one side drifts.
describe('the tag-mode shipping paths match the version-check.yml cli filter (#369)', () => {
  // The filter globs, spelled as the git pathspecs the gate diffs.
  const AS_PATHSPEC = { 'src/**': 'src', 'bin/**': 'bin', 'package.json': 'package.json' };

  test('SHIPPING_PATHS equals the cli filter list', () => {
    const wf = loadWorkflow('.github/workflows/version-check.yml');
    const filterStep = wf.jobs['detect-cli-changes'].steps.find(
      (s) => typeof s.uses === 'string' && s.uses.startsWith('dorny/paths-filter@'),
    );
    expect(filterStep).toBeDefined();
    const { cli } = yaml.load(filterStep.with.filters);
    expect(Array.isArray(cli)).toBe(true);
    cli.forEach((glob) => expect(Object.keys(AS_PATHSPEC)).toContain(glob));
    expect([...SHIPPING_PATHS].sort()).toEqual(cli.map((glob) => AS_PATHSPEC[glob]).sort());
  });
});

describe('auto-tag.yml runs the ordering gate before pushing a tag (#369)', () => {
  const wf = loadWorkflow('.github/workflows/auto-tag.yml');
  const job = wf.jobs['create-tag'];

  test('create-tag runs the gate in tag mode as the tag_check step', () => {
    expect(findJobWithRun(wf.jobs, TAG_GATE)).toBe(job);
    const gate = findStep(job.steps, TAG_GATE);
    expect(gate.id).toBe('tag_check');
    expect(gate.env).toEqual({ VERSION: '${{ steps.get_version.outputs.version }}' });
  });

  test('the gate runs after fetching tags and before the tag push', () => {
    const r = runs(job.steps);
    const gate = r.indexOf(TAG_GATE);
    const push = r.findIndex((cmd) => cmd.includes('git push origin'));
    expect(r.indexOf(FETCH)).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(r.indexOf(FETCH));
    expect(push).toBeGreaterThan(gate);
  });

  test('the push is gated on the check output, and the gate itself is not neutralised', () => {
    const push = job.steps.find((s) => (s.run || '').includes('git push origin'));
    expect(push.if).toBe("steps.tag_check.outputs.exists == 'false'");
    expect(neutralised(findStep(job.steps, TAG_GATE))).toEqual(CLEAN);
    expect(neutralised(job)).toEqual(CLEAN);
  });

  test('its checkout fetches full history and tags', () => {
    expect(checkoutOf(job.steps).with['fetch-depth']).toBe(0);
  });
});

// The issue's cases, asked of the gate itself rather than a copy of its rule.
describe('the gate decides the #369 cases', () => {
  test.each([
    ['0.40.13', ['v0.40.12', 'v0.40.14'], 'behind'],
    ['0.40.14', ['v0.40.12', 'v0.40.14'], 'tagged'],
    ['0.40.10', ['v0.40.9'], 'ahead'],
    ['0.40.9', ['v0.40.10'], 'behind'],
    ['0.41.0', ['v0.40.19', 'v0.41.0-rc.3'], 'ahead'],
    ['0.41.0-rc.1', ['v0.41.0'], 'behind'],
    ['0.41.0-rc.0', ['v0.40.19'], 'ahead'],
    ['0.41.0-rc.10', ['v0.41.0-rc.2'], 'ahead'],
    ['0.41.0-rc.2', ['v0.41.0-rc.10'], 'behind'],
  ])('%s against %j is %s', (version, tags, decision) => {
    expect(decide(version, tags).decision).toBe(decision);
  });
});
