'use strict';

// Runner parity for the finalize completeness rule (#335): `result finalize
// --scenario` reads a run `incomplete` while any declared step or assertion
// has no record (unrecordedEntries). That rule is only sound if `mauto run`
// itself records every step it reaches — a false condition, an optional miss,
// an on_failure skip, sub-steps under a skipped parent — and every assertion
// after each of them. A runner run that passes must leave nothing unrecorded.

const fs = require('fs');
const os = require('os');
const path = require('path');

const evaluator = require('../../../src/assertion/evaluator');
const catalog = require('../../../src/device/action-catalog');
const { ResultStore } = require('../../../src/result/store');
const { ScenarioValidator } = require('../../../src/scenario/validator');
const { unrecordedEntries } = require('../../../src/result/scenario-check');
const { runScenario } = require('../../../src/run/runner');
const { runSettings } = require('../../../src/run/settings');
const { makeFakeBridge, makeFakeClock, el } = require('../../helpers/fake-bridge');

const RUN_ID = 'run_20261118_120000';
const IOS_ONLY = { type: 'device_property', property: 'platform', operator: '==', value: 'ios' };
const exists = (id, afterStep, element) => ({
  id, after_step: afterStep, type: 'element_exists', description: `${element} is shown`, element_description: element,
});

const scenario = {
  $schema_version: '2.1',
  scenario_id: 'parity',
  name: 'Completeness parity',
  description: 'Every way mauto run can pass a step without running it.',
  platform: 'cross-platform',
  app_package: 'com.example.app',
  metadata: { app_version: 'test', environment: 'test' },
  preconditions: { device_actions: [{ action: 'set_orientation', value: 'portrait' }] },
  steps: [
    { id: 'start', action: 'tap', description: 'Tap home', target: 'Home' },
    { id: 'ios_only', action: 'tap', description: 'Skipped by a false condition', target: 'Accept', condition: IOS_ONLY },
    { id: 'promo', action: 'tap', description: 'An optional miss', target: 'Promo', optional: true },
    { id: 'soft', action: 'tap', description: 'A failure that is skipped', target: 'Nowhere', on_failure: 'skip' },
    {
      id: 'branch', action: 'tap', description: 'A parent that passes', target: 'Accept',
      sub_steps: [
        { id: 'branch_a', action: 'tap', description: 'First nested', target: 'Home' },
        { id: 'branch_b', action: 'tap', description: 'Second nested', target: 'Home' },
      ],
    },
    {
      id: 'ios_branch', action: 'tap', description: 'A parent skipped by its condition', target: 'Accept', condition: IOS_ONLY,
      sub_steps: [
        {
          id: 'ios_a', action: 'tap', description: 'Never runs', target: 'Home',
          sub_steps: [{ id: 'ios_deep', action: 'tap', description: 'Never runs either', target: 'Home' }],
        },
      ],
    },
  ],
  assertions: [
    exists('after_start', 'start', 'Home'),
    exists('after_ios_only', 'ios_only', 'Home'),
    exists('after_promo', 'promo', 'Home'),
    exists('after_soft', 'soft', 'Home'),
    exists('after_branch_b', 'branch_b', 'Accept'),
    exists('after_ios_deep', 'ios_deep', 'Home'),
    exists('after_ios_branch', 'ios_branch', 'Home'),
  ],
};

describe('runner parity with the finalize completeness rule (#335)', () => {
  let projectRoot;
  let store;
  let finalized;

  beforeAll(async () => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-parity-'));
    const bridge = makeFakeBridge({ elements: () => [el('Home'), el('Accept')] });
    store = new ResultStore({ runId: RUN_ID, scenarioId: scenario.scenario_id, projectRoot });
    await runScenario({
      scenario, bridge, store, evaluator, catalog, projectRoot, runId: RUN_ID,
      clock: makeFakeClock(), settings: runSettings(null),
    });
    finalized = store.finalize();
  });
  afterAll(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  test('the scenario is valid', () => {
    expect(new ScenarioValidator().validate(scenario)).toMatchObject({ valid: true });
  });

  test('the run passes, having skipped what it did not run', () => {
    expect(finalized.status).toBe('passed');
    const status = Object.fromEntries(finalized.steps_executed.map((s) => [s.step_id, s.status]));
    expect(status).toMatchObject({ ios_only: 'skipped', promo: 'skipped', soft: 'skipped', ios_branch: 'skipped' });
  });

  test('a passing runner run leaves nothing unrecorded', () => {
    expect(unrecordedEntries(store.recorded(), scenario)).toEqual({ steps: [], assertions: [] });
  });
});
