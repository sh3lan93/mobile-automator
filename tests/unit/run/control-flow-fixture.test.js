'use strict';

// The exit criterion of replay R4 (#280): every control-flow field the runner
// understands is exercised by a fixture, and the fixture replays as
// documented. The field list is derived from the scenario schema, so a new
// control-flow field cannot be added without a fixture exercising it.

const fs = require('fs');
const os = require('os');
const path = require('path');

const evaluator = require('../../../src/assertion/evaluator');
const catalog = require('../../../src/device/action-catalog');
const schema = require('../../../src/schemas/scenario_schema.json');
const { ResultStore } = require('../../../src/result/store');
const { ScenarioValidator } = require('../../../src/scenario/validator');
const { flattenSteps } = require('../../../src/scenario/steps');
const { runScenario } = require('../../../src/run/runner');
const { runSettings } = require('../../../src/run/settings');
const { makeFakeBridge, makeFakeClock, el } = require('../../helpers/fake-bridge');

const scenario = require('../../fixtures/scenarios/control-flow.json');
const RUN_ID = 'run_20261110_130000';

// Step fields that steer which steps run and how failure is treated.
const CONTROL_FLOW_FIELDS = ['condition', 'optional', 'on_failure', 'retry_policy', 'sub_steps'];
const stepSchema = schema.definitions.step.properties;

describe('control-flow fixture', () => {
  const steps = flattenSteps(scenario).map((e) => e.step);

  test('is a valid scenario', () => {
    expect(new ScenarioValidator().validate(scenario)).toMatchObject({ valid: true });
  });

  test('the control-flow field list still names real schema fields', () => {
    for (const field of CONTROL_FLOW_FIELDS) expect(stepSchema).toHaveProperty(field);
  });

  test.each(CONTROL_FLOW_FIELDS)('some step uses %s', (field) => {
    expect(steps.some((s) => s[field] !== undefined)).toBe(true);
  });

  test.each(stepSchema.condition.properties.type.enum)('some step has a %s condition', (type) => {
    expect(steps.some((s) => s.condition && s.condition.type === type)).toBe(true);
  });

  test.each(stepSchema.on_failure.enum.filter((v) => v !== 'fail'))('some step has on_failure %s', (value) => {
    expect(steps.some((s) => s.on_failure === value)).toBe(true);
  });

  test('uses ${name} in a step and in an assertion, and a text_changed assertion', () => {
    expect(steps.some((s) => /\$\{\w+\}/.test(`${s.value}${s.target}`))).toBe(true);
    expect(scenario.assertions.some((a) => /\$\{\w+\}/.test(JSON.stringify(a)))).toBe(true);
    expect(scenario.assertions.some((a) => a.type === 'text_changed')).toBe(true);
  });

  describe('replayed', () => {
    let projectRoot;
    let bridge;
    let file;
    let finalized;

    beforeAll(async () => {
      projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-cf-'));
      // A counter every successful tap bumps; the 4th tap (the first of `flaky`) fails.
      const state = { counter: 7 };
      bridge = makeFakeBridge({
        elements: () => [el(String(state.counter), { accessibility_label: 'Counter' }), el('Home'), el('Accept')],
        methods: {
          tap: (_args, n) => {
            if (n === 4) throw new Error('flaky tap');
            state.counter += 1;
            return null;
          },
        },
      });
      const store = new ResultStore({ runId: RUN_ID, scenarioId: scenario.scenario_id, projectRoot });
      await runScenario({
        scenario, bridge, store, evaluator, catalog, projectRoot, runId: RUN_ID,
        clock: makeFakeClock(), settings: runSettings(null),
      });
      file = JSON.parse(fs.readFileSync(store.file, 'utf8'));
      finalized = store.finalize();
    });
    afterAll(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

    const step = (id) => file.steps_executed.find((s) => s.step_id === id);

    test('the run passes', () => {
      expect(finalized.status).toBe('passed');
    });

    test.each([
      ['cap', 'passed', null],
      ['on_android', 'passed', true],
      ['ios_only', 'skipped', false],
      ['after_ios', 'passed', true],
      ['big_count', 'passed', true],
      ['promo', 'skipped', null],
      ['soft', 'skipped', null],
      ['flaky', 'passed', null],
      ['branch', 'passed', true],
    ])('step %s is %s with condition_evaluated %s', (id, status, condition) => {
      expect(step(id)).toMatchObject({ status, condition_evaluated: condition });
      expect(typeof step(id).step_duration_ms).toBe('number');
    });

    test('flaky retried with its backoff', () => {
      expect(step('flaky')).toMatchObject({ retried: true, retry_count: 1, step_duration_ms: 200 });
    });

    test('sub_steps are recorded on the parent, not as top-level steps', () => {
      expect(file.steps_executed.map((s) => s.step_id)).not.toContain('branch_tap');
      expect(step('branch').sub_steps_executed.map((s) => [s.step_id, s.status])).toEqual([
        ['branch_tap', 'passed'],
        ['branch_type', 'passed'],
      ]);
    });

    test('${count} reached the device', () => {
      expect(bridge.of('type')[0].args).toEqual(['n=7']);
    });

    test('every assertion passed, including the nested one and text_changed', () => {
      expect(file.assertion_results.map((a) => [a.assertion_id, a.status])).toEqual([
        ['count_kept', 'passed'],
        ['count_changed', 'passed'],
        ['nested', 'passed'],
      ]);
    });
  });
});
