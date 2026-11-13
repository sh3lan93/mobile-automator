'use strict';

// Control flow and variables (replay R4, #280): conditions, optional,
// on_failure, retry, sub_steps, ${name} substitution and the text_changed
// snapshot, through runScenario on a fake bridge and a real ResultStore.

const fs = require('fs');
const os = require('os');
const path = require('path');

const evaluator = require('../../../src/assertion/evaluator');
const catalog = require('../../../src/device/action-catalog');
const { ResultStore } = require('../../../src/result/store');
const { runScenario } = require('../../../src/run/runner');
const { runSettings } = require('../../../src/run/settings');
const { makeFakeBridge, makeFakeClock, el } = require('../../helpers/fake-bridge');

const RUN_ID = 'run_20261110_120000';
const step = (id, action, extra = {}) => ({ id, action, description: id, ...extra });

let projectRoot;
beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-r4-'));
});
afterEach(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

async function exec(steps, { assertions = [], variables, bridge, clock = makeFakeClock() } = {}) {
  const sc = { $schema_version: '2.1', scenario_id: 'demo', app_package: 'com.example.app', variables, steps, assertions };
  const store = new ResultStore({ runId: RUN_ID, scenarioId: 'demo', projectRoot });
  const b = bridge || makeFakeBridge({ elements: [[el('Home'), el('Accept')]] });
  const r = await runScenario({
    scenario: sc, bridge: b, store, evaluator, catalog, projectRoot, runId: RUN_ID, clock, settings: runSettings(null),
  });
  const file = JSON.parse(fs.readFileSync(store.file, 'utf8'));
  const finalized = store.finalize();
  const byId = Object.fromEntries(file.steps_executed.map((s) => [s.step_id, s]));
  return { ...r, b, file, finalized, byId, clock };
}

describe('condition', () => {
  test('a true condition runs the step and records condition_evaluated: true', async () => {
    const r = await exec([step('t', 'tap', { target: 'Accept', condition: { type: 'element_visible', element_description: 'Accept' } })]);
    expect(r.finalized.status).toBe('passed');
    expect(r.b.of('tap')).toHaveLength(1);
    expect(r.byId.t).toMatchObject({ status: 'passed', condition_evaluated: true });
  });

  test('a false condition skips the step without a failure and records condition_evaluated: false', async () => {
    const r = await exec([step('t', 'tap', { target: 'Accept', condition: { type: 'device_property', property: 'platform', value: 'ios' } })]);
    expect(r.finalized.status).toBe('passed');
    expect(r.b.of('tap')).toHaveLength(0);
    expect(r.byId.t).toMatchObject({ status: 'skipped', condition_evaluated: false, error_message: null });
  });

  test('a step with no condition records condition_evaluated: null', async () => {
    const r = await exec([step('t', 'tap', { target: 'Accept' })]);
    expect(r.byId.t.condition_evaluated).toBeNull();
  });

  test('previous_step_skipped follows a step skipped by its condition', async () => {
    const r = await exec([
      step('a', 'tap', { target: 'Accept', condition: { type: 'element_visible', element_description: 'Nope' } }),
      step('b', 'tap', { target: 'Home', condition: { type: 'previous_step_skipped', step_id: 'a' } }),
      step('c', 'tap', { target: 'Home', condition: { type: 'previous_step_skipped', step_id: 'b' } }),
    ]);
    expect(r.byId.a.status).toBe('skipped');
    expect(r.byId.b).toMatchObject({ status: 'passed', condition_evaluated: true });
    expect(r.byId.c).toMatchObject({ status: 'skipped', condition_evaluated: false });
  });

  test('variable_value reads a captured variable', async () => {
    const r = await exec(
      [
        step('cap', 'capture_value', { target: 'Home', capture_to: 'greeting' }),
        step('t', 'tap', { target: 'Accept', condition: { type: 'variable_value', variable_name: 'greeting', operator: '==', value: 'Home' } }),
      ],
      { variables: { greeting: { type: 'string' } } }
    );
    expect(r.byId.t).toMatchObject({ status: 'passed', condition_evaluated: true });
  });

  test('device_property orientation asks the bridge', async () => {
    const b = makeFakeBridge({ elements: [[el('Home')]], methods: { getOrientation: () => 'landscape' } });
    const r = await exec([step('t', 'tap', { target: 'Home', condition: { type: 'device_property', property: 'orientation', value: 'landscape' } })], { bridge: b });
    expect(r.byId.t.condition_evaluated).toBe(true);
  });

  test('an undecidable device_property ends the run incomplete: needs_agent, nothing after it runs', async () => {
    const r = await exec([
      step('t', 'tap', { target: 'Home', condition: { type: 'device_property', property: 'api_level', operator: '>=', value: 33 } }),
      step('u', 'tap', { target: 'Home' }),
    ]);
    expect(r.byId.t).toMatchObject({ status: 'skipped', needs_agent: true });
    expect(r.byId.u).toBeUndefined();
    expect(r.finalized.status).toBe('incomplete');
  });

  test('a condition on an uncaptured variable fails the step', async () => {
    const r = await exec([step('t', 'tap', { target: 'Home', condition: { type: 'variable_value', variable_name: 'ghost', value: 1 } })]);
    expect(r.finalized.status).toBe('failed');
    expect(r.failures.join()).toContain('ghost');
  });

  test('a skipped parent skips its sub_steps, recorded and nested', async () => {
    const r = await exec([
      step('p', 'tap', {
        target: 'Accept',
        condition: { type: 'element_visible', element_description: 'Nope' },
        sub_steps: [step('c1', 'tap', { target: 'Home' }), step('c2', 'tap', { target: 'Home', sub_steps: [step('g1', 'tap', { target: 'Home' })] })],
      }),
      step('after', 'tap', { target: 'Home', condition: { type: 'previous_step_skipped', step_id: 'g1' } }),
    ]);
    expect(r.b.of('tap')).toHaveLength(1); // only `after`, which sees g1 skipped
    expect(r.byId.p.sub_steps_executed).toEqual([
      { step_id: 'c1', status: 'skipped', screenshot: null, error_message: null },
      { step_id: 'c2', status: 'skipped', screenshot: null, error_message: null, sub_steps_executed: [{ step_id: 'g1', status: 'skipped', screenshot: null, error_message: null }] },
    ]);
    expect(r.byId.after.status).toBe('passed');
  });
});

describe('failure handling', () => {
  const missing = { target: 'Nowhere' };

  test('an optional step that fails is skipped, the run continues and passes', async () => {
    const r = await exec([step('o', 'tap', { ...missing, optional: true }), step('t', 'tap', { target: 'Home' })]);
    expect(r.finalized.status).toBe('passed');
    expect(r.failures).toEqual([]);
    expect(r.byId.o).toMatchObject({ status: 'skipped' });
    expect(r.byId.o.error_message).toContain('Nowhere');
    expect(r.byId.o.screenshot).toBeNull();
    expect(r.byId.t.status).toBe('passed');
    expect(r.file.observations.map((o) => o.message).join()).toContain('optional step failed and was skipped');
  });

  test('on_failure: skip continues like optional', async () => {
    const r = await exec([step('s', 'tap', { ...missing, on_failure: 'skip' }), step('t', 'tap', { target: 'Home' })]);
    expect(r.finalized.status).toBe('passed');
    expect(r.byId.s.status).toBe('skipped');
    expect(r.byId.t.status).toBe('passed');
  });

  test('on_failure: fail (the default) still stops the run', async () => {
    const r = await exec([step('f', 'tap', { ...missing, on_failure: 'fail' }), step('t', 'tap', { target: 'Home' })]);
    expect(r.finalized.status).toBe('failed');
    expect(r.failedStep).toBe('f');
    expect(r.byId.t).toBeUndefined();
  });

  test('a fatal error is not forgiven by optional or skip', async () => {
    const r = await exec([step('o', 'tap', { target: 'Home', target_pattern: '(', optional: true, on_failure: 'skip' })]);
    expect(r.finalized.status).toBe('failed');
    expect(r.byId.o.status).toBe('failed');
  });

  test('an optional step that is retried and still fails is then skipped', async () => {
    const r = await exec([step('o', 'tap', { ...missing, optional: true, retry_policy: { max_attempts: 3, backoff_ms: 10 } })]);
    expect(r.byId.o).toMatchObject({ status: 'skipped', retry_count: 2 });
  });

  test('on_failure: retry honours backoff_ms on the fake clock', async () => {
    let n = 0;
    const b = makeFakeBridge({ elements: [[el('Home')]], methods: { tap: () => { if (++n < 3) throw new Error('flaky'); return null; } } });
    const clock = makeFakeClock(1000);
    const r = await exec([step('t', 'tap', { target: 'Home', on_failure: 'retry', retry_policy: { max_attempts: 3, backoff_ms: 250 } })], { bridge: b, clock });
    expect(r.finalized.status).toBe('passed');
    expect(r.byId.t).toMatchObject({ status: 'passed', retried: true, retry_count: 2, step_duration_ms: 500 });
    expect(clock.now()).toBe(1500);
  });

  test('on_failure: retry with no retry_policy makes two attempts one second apart', async () => {
    const b = makeFakeBridge({ elements: [[el('Home')]], methods: { tap: () => { throw new Error('nope'); } } });
    const clock = makeFakeClock();
    const r = await exec([step('t', 'tap', { target: 'Home', on_failure: 'retry' })], { bridge: b, clock });
    expect(r.finalized.status).toBe('failed');
    expect(b.of('tap')).toHaveLength(2);
    expect(clock.now()).toBe(1000);
  });

  test('step_duration_ms is recorded for every step', async () => {
    const r = await exec([step('t', 'tap', { target: 'Home' })]);
    expect(r.byId.t.step_duration_ms).toBe(0);
  });
});

describe('sub_steps', () => {
  test('run after the parent, are summarised on it, and resume at the next top-level step', async () => {
    const r = await exec([
      step('p', 'tap', { target: 'Accept', sub_steps: [step('c1', 'tap', { target: 'Home' }), step('c2', 'tap', { target: 'Home', optional: true, condition: { type: 'element_visible', element_description: 'Nope' } })] }),
      step('next', 'tap', { target: 'Home' }),
    ]);
    expect(r.finalized.status).toBe('passed');
    expect(r.file.steps_executed.map((s) => s.step_id)).toEqual(['p', 'next']);
    expect(r.byId.p.sub_steps_executed).toEqual([
      { step_id: 'c1', status: 'passed', screenshot: null, error_message: null },
      { step_id: 'c2', status: 'skipped', screenshot: null, error_message: null },
    ]);
    expect(r.b.of('tap')).toHaveLength(3);
  });

  test('nested after_step assertions are evaluated and recorded', async () => {
    const r = await exec(
      [step('p', 'tap', { target: 'Accept', sub_steps: [step('c1', 'tap', { target: 'Home' })] })],
      { assertions: [{ id: 'on_child', after_step: 'c1', type: 'element_exists', element_description: 'Home', description: 'd' }] }
    );
    expect(r.file.assertion_results.map((a) => [a.assertion_id, a.status])).toEqual([['on_child', 'passed']]);
  });

  test('a failing sub-step fails the parent, stops the run and names the sub-step', async () => {
    const r = await exec([
      step('p', 'tap', { target: 'Accept', sub_steps: [step('c1', 'tap', { target: 'Nowhere' }), step('c2', 'tap', { target: 'Home' })] }),
      step('next', 'tap', { target: 'Home' }),
    ]);
    expect(r.finalized.status).toBe('failed');
    expect(r.failedStep).toBe('p');
    expect(r.byId.p.status).toBe('failed');
    expect(r.byId.p.error_message).toContain('sub-step c1');
    expect(r.byId.p.sub_steps_executed).toEqual([expect.objectContaining({ step_id: 'c1', status: 'failed' })]);
    expect(r.byId.next).toBeUndefined();
  });

  test('a sub-step that needs an agent ends the run incomplete', async () => {
    const r = await exec([step('p', 'tap', { target: 'Accept', sub_steps: [step('c1', 'enable_wifi')] })]);
    expect(r.byId.p).toMatchObject({ status: 'skipped', needs_agent: true });
    expect(r.finalized.status).toBe('incomplete');
  });

  test('a parent that failed harmlessly (optional) skips its sub_steps', async () => {
    const r = await exec([step('p', 'tap', { target: 'Nowhere', optional: true, sub_steps: [step('c1', 'tap', { target: 'Home' })] })]);
    expect(r.b.of('tap')).toHaveLength(0);
    expect(r.byId.p.sub_steps_executed).toEqual([{ step_id: 'c1', status: 'skipped', screenshot: null, error_message: null }]);
  });

  test('a skipped parent\'s assertions still run', async () => {
    const r = await exec(
      [step('p', 'tap', { target: 'Accept', condition: { type: 'element_visible', element_description: 'Nope' } })],
      { assertions: [{ id: 'still', after_step: 'p', type: 'element_exists', element_description: 'Home', description: 'd' }] }
    );
    expect(r.file.assertion_results).toHaveLength(1);
  });

  test('the trace counts every step including sub-steps', async () => {
    const traced = [];
    const sc = { scenario_id: 'demo', app_package: 'a', steps: [step('p', 'tap', { target: 'Home', sub_steps: [step('c', 'tap', { target: 'Home' })] })], assertions: [] };
    const store = new ResultStore({ runId: RUN_ID, scenarioId: 'demo', projectRoot });
    await runScenario({
      scenario: sc, bridge: makeFakeBridge({ elements: [[el('Home')]] }), store, evaluator, catalog, projectRoot, runId: RUN_ID,
      clock: makeFakeClock(), settings: runSettings(null), trace: { start: () => {}, step: (ok) => traced.push(ok) },
    });
    expect(traced).toEqual([true, true]);
  });
});

describe('${name} substitution', () => {
  const variables = { code: { type: 'string' } };
  const capture = step('cap', 'capture_value', { target: 'Order', capture_to: 'code' });

  test('step value and target read the captured variable', async () => {
    const b = makeFakeBridge({ elements: [[el('Order A-17'), el('Field Order A-17')]] });
    const r = await exec([capture, step('typed', 'type', { value: 'code ${code}' }), step('tapped', 'tap', { target: 'Field ${code}' })], { variables, bridge: b });
    expect(r.finalized.status).toBe('passed');
    expect(b.of('type')[0].args).toEqual(['code Order A-17']);
    expect(b.of('tap')).toHaveLength(1);
  });

  test('an uncaptured reference fails the step at once, without a device call', async () => {
    const r = await exec([step('typed', 'type', { value: '${code}' })], { variables });
    expect(r.finalized.status).toBe('failed');
    expect(r.byId.typed.error_message).toContain('"code"');
    expect(r.b.of('type')).toHaveLength(0);
    expect(r.byId.typed.retry_count).toBe(0);
  });

  test('assertion string fields read the variable and the verdict records the substituted expectation', async () => {
    const r = await exec(
      [capture],
      { variables, bridge: makeFakeBridge({ elements: [[el('Order A-17')]] }), assertions: [{ id: 'a', after_step: 'cap', type: 'element_text', element_description: 'Order', expected_value: '${code}', description: 'd' }] }
    );
    expect(r.file.assertion_results[0]).toMatchObject({ status: 'passed', expected: 'Order A-17' });
  });

  test('an assertion naming an uncaptured variable is a failed assertion, not a crash', async () => {
    const r = await exec(
      [step('t', 'tap', { target: 'Home' })],
      { assertions: [{ id: 'a', after_step: 't', type: 'element_text', element_description: 'Home', expected_value: '${ghost}', description: 'd' }] }
    );
    expect(r.file.assertion_results[0].status).toBe('failed');
    expect(r.file.assertion_results[0].message).toContain('ghost');
  });
});

describe('text_changed previous snapshot', () => {
  test('compares against the screen before the step', async () => {
    const b = makeFakeBridge({ elements: [[el('Count 1')], [el('Count 1')], [el('Count 2')]] });
    // listElements calls: snapshot (1), tap resolve (2), assertion (3)
    const r = await exec(
      [step('t', 'tap', { target: 'Count' })],
      { bridge: b, assertions: [{ id: 'changed', after_step: 't', type: 'text_changed', element_description: 'Count', description: 'd' }] }
    );
    expect(r.file.assertion_results[0]).toMatchObject({ status: 'passed' });
    expect(r.file.assertion_results[0].message).toContain("from 'Count 1' to 'Count 2'");
  });

  test('fails when the text did not change', async () => {
    const b = makeFakeBridge({ elements: [[el('Count 1')]] });
    const r = await exec(
      [step('t', 'tap', { target: 'Count' })],
      { bridge: b, assertions: [{ id: 'changed', after_step: 't', type: 'text_changed', element_description: 'Count', description: 'd' }] }
    );
    expect(r.file.assertion_results[0].status).toBe('failed');
  });

  test('takes no snapshot when no text_changed assertion follows the step', async () => {
    const b = makeFakeBridge({ elements: [[el('Home')]] });
    await exec([step('t', 'tap', { target: 'Home' })], { bridge: b });
    expect(b.of('listElements')).toHaveLength(1);
  });
});
