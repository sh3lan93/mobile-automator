'use strict';

// #335: `result finalize --scenario` must not pass a run that never recorded
// part of the scenario. The repro: `mauto run` stopped at a needs_agent step,
// the agent resolved that step and finalized without doing the rest.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { handleResultAddAssertion, handleResultAddStep, handleResultFinalize, toEnvelope } = require('../../../src/cli');
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
// What `mauto run` leaves when it stops at a needs_agent `launch`: the step
// recorded pending, the run finalized incomplete with the scenario's hash.
function pendingRun() {
  n += 1;
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-complete-'));
  const scenarioPath = path.join(projectRoot, 'checkout.json');
  fs.writeFileSync(scenarioPath, JSON.stringify(SCENARIO, null, 2));
  const sha = crypto.createHash('sha256').update(fs.readFileSync(scenarioPath)).digest('hex');
  const runId = `run_20261118_1300${String(n).padStart(2, '0')}`;
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

describe('result finalize --scenario reads unrecorded entries as incomplete (#335)', () => {
  test('the repro: the resolved step alone finalizes incomplete, exit 7, naming what is missing', () => {
    const { deps, runId, scenarioPath, file } = pendingRun();
    handleResultAddStep(deps, { runId, stepId: 'launch', status: 'pass' });

    const f = invoke(() => handleResultFinalize(deps, { runId, scenario: scenarioPath }));
    expect(f.exitKind).toBe('incomplete');
    expect(exitCodeFor(f.exitKind)).toBe(7);
    expect(f.envelope.ok).toBe(false);
    expect(f.envelope.error.kind).toBe('incomplete');
    expect(f.envelope.error.message).toBe(`run ${runId} incomplete: 1 declared step(s) and 1 assertion(s) never recorded`);
    expect(f.envelope.data).toMatchObject({ status: 'incomplete', unrecorded: { steps: ['tap'], assertions: ['bought'] } });
    expect(f.envelope.hint).toContain('Never recorded: steps tap; assertions bought.');
    expect(f.envelope.hint).toContain(`--step-id tap --status <pass|fail|skipped>`);
    // Filled from the scenario: the step it follows and its type.
    expect(f.envelope.hint).toContain(
      `mauto result add-assertion --run-id ${runId} --step-id tap --assertion-id bought --type element_exists --pass <true|false> --message "<why>"`
    );
    // The file is written incomplete, and carries no `unrecorded` field: the
    // result schema is unchanged.
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(saved.status).toBe('incomplete');
    expect(saved).not.toHaveProperty('unrecorded');
  });

  test('recording the rest then passes, exit 0', () => {
    const { deps, runId, scenarioPath } = pendingRun();
    handleResultAddStep(deps, { runId, stepId: 'launch', status: 'pass' });
    expect(invoke(() => handleResultFinalize(deps, { runId, scenario: scenarioPath })).exitKind).toBe('incomplete');

    handleResultAddStep(deps, { runId, stepId: 'tap', status: 'pass' });
    handleResultAddAssertion(deps, { runId, stepId: 'tap', assertionId: 'bought', type: 'element_exists', pass: 'true' });
    const f = invoke(() => handleResultFinalize(deps, { runId, scenario: scenarioPath }));
    expect(f.exitKind).toBe('ok');
    expect(exitCodeFor(f.exitKind)).toBe(0);
    expect(f.envelope.data.status).toBe('passed');
    expect(f.envelope.data).not.toHaveProperty('unrecorded');
  });

  test('a step recorded skipped is recorded: its assertion still has to be', () => {
    const { deps, runId, scenarioPath } = pendingRun();
    handleResultAddStep(deps, { runId, stepId: 'launch', status: 'pass' });
    handleResultAddStep(deps, { runId, stepId: 'tap', status: 'skipped' });
    const f = invoke(() => handleResultFinalize(deps, { runId, scenario: scenarioPath }));
    expect(f.envelope.data.unrecorded).toEqual({ steps: [], assertions: ['bought'] });
  });

  test('explicit --status passed over gaps -> invalid_input, nothing written', () => {
    const { deps, runId, scenarioPath, file } = pendingRun();
    handleResultAddStep(deps, { runId, stepId: 'launch', status: 'pass' });
    const before = fs.readFileSync(file, 'utf8');
    const f = invoke(() => handleResultFinalize(deps, { runId, scenario: scenarioPath, status: 'passed' }));
    expect(f.exitKind).toBe('invalid_input');
    expect(f.envelope.error.message).toMatch(/never recorded/);
    expect(f.envelope.error.message).toContain('tap');
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  test('explicit --status incomplete over gaps is allowed', () => {
    const { deps, runId, scenarioPath } = pendingRun();
    handleResultAddStep(deps, { runId, stepId: 'launch', status: 'pass' });
    const f = invoke(() => handleResultFinalize(deps, { runId, scenario: scenarioPath, status: 'incomplete' }));
    expect(f.exitKind).toBe('incomplete');
    expect(f.envelope.data.unrecorded).toEqual({ steps: ['tap'], assertions: ['bought'] });
  });

  test('a failed run stays failed: later steps legitimately never ran, no gaps reported', () => {
    const { deps, runId, scenarioPath } = pendingRun();
    handleResultAddStep(deps, { runId, stepId: 'launch', status: 'fail', errorMessage: 'crashed' });
    const f = invoke(() => handleResultFinalize(deps, { runId, scenario: scenarioPath }));
    expect(f.exitKind).toBe('test_failed');
    expect(f.envelope.data.status).toBe('failed');
    expect(f.envelope.data).not.toHaveProperty('unrecorded');
  });

  test('a run still pending also lists the gaps', () => {
    const { deps, runId, scenarioPath } = pendingRun();
    const f = invoke(() => handleResultFinalize(deps, { runId, scenario: scenarioPath }));
    expect(f.exitKind).toBe('incomplete');
    expect(f.envelope.data.unrecorded).toEqual({ steps: ['tap'], assertions: ['bought'] });
    expect(f.envelope.hint.split('\n')[0]).toBe('Pending step launch: launch it by hand');
    expect(f.envelope.hint).toContain('Never recorded: steps tap; assertions bought.');
  });
});
