'use strict';

// #337: an explicit `result finalize --status` is checked against the records
// the store re-reads under its lock, not against a snapshot taken before it.
// A failed step landing between that snapshot and the lock used to let
// `--status incomplete` (or `passed`) through over a run whose own records
// derive `failed` — the "greener than derived" file the guard exists to
// refuse.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { handleResultAddStep, handleResultFinalize, toEnvelope } = require('../../../src/cli');
const { ResultStore } = require('../../../src/result/store');
const { ScenarioValidator } = require('../../../src/scenario/validator');
const { exitCodeFor } = require('../../../src/output/envelope');

const SCENARIO = {
  $schema_version: '2.1',
  scenario_id: 'checkout',
  name: 'Checkout',
  description: 'Launch, then tap through.',
  platform: 'cross-platform',
  app_package: 'com.example.app',
  metadata: { app_version: 'test', environment: 'test' },
  steps: [
    { id: 'launch', action: 'launch_app', description: 'Launch the app' },
    { id: 'tap', action: 'tap', description: 'Tap buy', target: 'Buy' },
  ],
  assertions: [{ id: 'bought', after_step: 'tap', type: 'element_exists', description: 'Thanks shown', element_description: 'Thanks' }],
};

function invoke(fn) {
  try {
    return fn();
  } catch (err) {
    return toEnvelope(err);
  }
}

let n = 0;
// A run `mauto run` left with `launch` pending (needs_agent), finalized
// incomplete: it derives `incomplete`, so `--status incomplete` is allowed
// over it — until a failed step lands.
function pendingRun() {
  n += 1;
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-status-lock-'));
  const scenarioPath = path.join(projectRoot, 'checkout.json');
  fs.writeFileSync(scenarioPath, JSON.stringify(SCENARIO, null, 2));
  const sha = crypto.createHash('sha256').update(fs.readFileSync(scenarioPath)).digest('hex');
  const runId = `run_20261118_1400${String(n).padStart(2, '0')}`;
  const store = new ResultStore({ runId, scenarioId: 'checkout', projectRoot });
  store.addStep({ step_id: 'launch', status: 'skipped', needs_agent: true, error_message: 'launch it by hand' });
  const runner = {
    kind: 'runner', mauto_version: '0.0.1', engine: 'mobilecli', platform: 'android', device_id: 'emu',
    scenario_path: 'checkout.json', scenario_sha256: sha, mode: 'platform-agnostic',
  };
  expect(store.finalize({ executor: runner }).status).toBe('incomplete');
  const deps = { resultStoreFactory: (o) => new ResultStore(o), projectRoot, validator: new ScenarioValidator() };
  const file = path.join(projectRoot, '.mobile-automator', 'results', `${runId}.json`);
  return { deps, runId, scenarioPath, file };
}

// Race a failed `tap` step in just before the LAST store finalize builds —
// the one whose finalize takes the lock — so every earlier read sees the run
// without it. The construction count comes from a dry run of the same call,
// so the test does not hard-code how many stores the handler builds.
function raceFailedStepBeforeLastStore(opts, setup = () => {}) {
  let total = 0;
  const dry = pendingRun();
  setup(dry);
  const counting = { ...dry.deps, resultStoreFactory: (o) => { total += 1; return new ResultStore(o); } };
  invoke(() => handleResultFinalize(counting, opts(dry)));
  expect(total).toBeGreaterThan(0);

  const run = pendingRun();
  setup(run);
  let calls = 0;
  const racing = {
    ...run.deps,
    resultStoreFactory: (o) => {
      calls += 1;
      const store = new ResultStore(o);
      if (calls === total) {
        new ResultStore(o).addStep({ step_id: 'tap', status: 'fail', error_message: 'Buy missing' });
      }
      return store;
    },
  };
  const before = fs.readFileSync(run.file, 'utf8');
  const f = invoke(() => handleResultFinalize(racing, opts(run)));
  return { f, before, file: run.file, calls };
}

describe('finalize --status is checked under the store lock (#337)', () => {
  // The agent resolved the pending `launch`: without --scenario the run now
  // derives `passed`, so `--status passed` clears any early read.
  const resolveLaunch = (r) => handleResultAddStep(r.deps, { runId: r.runId, stepId: 'launch', status: 'pass' });

  test.each([
    ['--status incomplete, with --scenario', (r) => ({ runId: r.runId, scenario: r.scenarioPath, status: 'incomplete' }), undefined],
    ['--status incomplete, without --scenario', (r) => ({ runId: r.runId, status: 'incomplete' }), undefined],
    ['--status passed, without --scenario', (r) => ({ runId: r.runId, status: 'passed' }), resolveLaunch],
  ])('%s over a failed step recorded after the snapshot -> invalid_input, nothing written', (_label, opts, setup) => {
    const { f, before, file, calls } = raceFailedStepBeforeLastStore(opts, setup);
    expect(calls).toBeGreaterThan(0);
    expect(f.exitKind).toBe('invalid_input');
    expect(exitCodeFor(f.exitKind)).toBe(exitCodeFor('invalid_input'));
    expect(f.envelope.ok).toBe(false);
    expect(f.envelope.error.kind).toBe('invalid_input');
    expect(f.envelope.error.message).toMatch(/derive "failed"/);
    expect(f.envelope.hint).toMatch(/never better/);
    // The racing step is on disk; the finalize wrote nothing over it.
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(saved._in_progress).toBe(true);
    expect(saved.steps_executed.map((s) => [s.step_id, s.status])).toContainEqual(['tap', 'failed']);
    expect(fs.readFileSync(file, 'utf8')).not.toBe(before); // only the racing add-step changed it
  });

  test('--status failed over the same race is allowed: worse is never refused', () => {
    const { f, file } = raceFailedStepBeforeLastStore((r) => ({ runId: r.runId, scenario: r.scenarioPath, status: 'failed' }));
    expect(f.exitKind).toBe('test_failed');
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).status).toBe('failed');
  });
});
