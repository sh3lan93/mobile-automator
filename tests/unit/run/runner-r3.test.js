'use strict';

// Replay R3 runner behaviour: preconditions, needs-agent stops, run
// variables, and a scenario exercising every supported action.

const fs = require('fs');
const os = require('os');
const path = require('path');

const evaluator = require('../../../src/assertion/evaluator');
const catalog = require('../../../src/device/action-catalog');
const { ResultStore } = require('../../../src/result/store');
const { runScenario } = require('../../../src/run/runner');
const { runSettings } = require('../../../src/run/settings');
const { makeFakeBridge, makeFakeClock, el } = require('../../helpers/fake-bridge');

const RUN_ID = 'run_20261112_120000';

let projectRoot;
beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-run-r3-'));
});
afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

async function exec(sc, bridge, extra = {}) {
  const store = new ResultStore({ runId: RUN_ID, scenarioId: sc.scenario_id, projectRoot });
  const outcome = await runScenario({
    scenario: sc, bridge, store, evaluator, catalog, projectRoot, runId: RUN_ID, clock: makeFakeClock(), settings: runSettings(null), ...extra,
  });
  const file = JSON.parse(fs.readFileSync(store.file, 'utf8'));
  const finalized = store.finalize();
  return { ...outcome, file, finalized };
}

const scenarioOf = (steps, extra = {}) => ({
  $schema_version: '2.1', scenario_id: 'demo', app_package: 'com.example.app', steps, assertions: [], ...extra,
});

describe('preconditions', () => {
  test('run before step 1, recorded as precondition_<n>, in order', async () => {
    const b = makeFakeBridge({ elements: [[el('Home')]] });
    const r = await exec(scenarioOf(
      [{ id: 'launch', action: 'launch_app', description: 'd' }],
      { preconditions: { device_actions: [
        { action: 'uninstall_app' },
        { action: 'set_orientation', value: 'landscape' },
      ] } }
    ), b);
    expect(r.file.steps_executed.map((s) => [s.step_id, s.status])).toEqual([
      ['precondition_1', 'passed'], ['precondition_2', 'passed'], ['launch', 'passed'],
    ]);
    expect(b.methods().slice(0, 2)).toEqual(['uninstallApp', 'setOrientation']);
    expect(b.methods()).toContain('restartApp');
    expect(r.finalized.status).toBe('passed');
  });

  test('a failed precondition stops the run like a failed step', async () => {
    const b = makeFakeBridge({ methods: { uninstallApp: () => { throw new Error('not installed'); } } });
    const r = await exec(scenarioOf(
      [{ id: 'launch', action: 'launch_app', description: 'd' }],
      { preconditions: { device_actions: [{ action: 'uninstall_app' }] } }
    ), b);
    expect(r.failedStep).toBe('precondition_1');
    expect(r.failures).toEqual(['step precondition_1 (uninstall_app): not installed']);
    expect(r.file.steps_executed).toHaveLength(1);
    expect(r.finalized.status).toBe('failed');
  });

  test('no preconditions block is fine', async () => {
    const r = await exec(scenarioOf([{ id: 'h', action: 'dismiss_keyboard', description: 'd' }]), makeFakeBridge());
    expect(r.file.steps_executed.map((s) => s.step_id)).toEqual(['h']);
  });
});

describe('needs_agent', () => {
  test('an unsupported action is recorded skipped + needs_agent, the run stops, and finalizes incomplete', async () => {
    const b = makeFakeBridge();
    const r = await exec(scenarioOf([
      { id: 'wifi', action: 'disable_wifi', description: 'd' },
      { id: 'h', action: 'dismiss_keyboard', description: 'd' },
    ]), b);
    expect(r.file.steps_executed).toHaveLength(1);
    expect(r.file.steps_executed[0]).toMatchObject({ step_id: 'wifi', status: 'skipped', needs_agent: true });
    expect(r.file.steps_executed[0].error_message).toMatch(/disable_wifi/);
    expect(r.failures).toEqual([]);
    expect(r.failedStep).toBeNull();
    expect(r.finalized.status).toBe('incomplete');
    expect(b.calls).toEqual([]);
  });

  test('a precondition that needs an agent stops before step 1', async () => {
    const b = makeFakeBridge();
    const r = await exec(scenarioOf(
      [{ id: 'launch', action: 'launch_app', description: 'd' }],
      { preconditions: { device_actions: [{ action: 'clear_app_data' }, { action: 'set_orientation', value: 'portrait' }] } }
    ), b);
    expect(r.file.steps_executed.map((s) => [s.step_id, s.status, s.needs_agent])).toEqual([
      ['precondition_1', 'skipped', true],
    ]);
    expect(r.finalized.status).toBe('incomplete');
  });

  test('install_app without a value needs an agent', async () => {
    const r = await exec(scenarioOf(
      [{ id: 'launch', action: 'launch_app', description: 'd' }],
      { preconditions: { device_actions: [{ action: 'install_app' }] } }
    ), makeFakeBridge());
    expect(r.file.steps_executed[0]).toMatchObject({ step_id: 'precondition_1', status: 'skipped', needs_agent: true });
    expect(r.finalized.status).toBe('incomplete');
  });

  test('the run trace stamps a needs_agent step ok: it is not a failure', async () => {
    const stamps = [];
    const trace = { start() {}, step: (ok) => stamps.push(ok) };
    await exec(scenarioOf([{ id: 'wifi', action: 'enable_wifi', description: 'd' }]), makeFakeBridge(), { trace });
    expect(stamps).toEqual([true]);
  });

  test('the run trace stamps a failed step not ok', async () => {
    const stamps = [];
    const trace = { start() {}, step: (ok) => stamps.push(ok) };
    await exec(scenarioOf([{ id: 'go', action: 'tap', target: 'Nope', description: 'd' }]), makeFakeBridge({ elements: [[el('Home')]] }), { trace });
    expect(stamps).toEqual([false]);
  });

  test('is not retried', async () => {
    const r = await exec(scenarioOf([
      { id: 'wifi', action: 'enable_wifi', description: 'd', retry_policy: { max_attempts: 3, backoff_ms: 10 } },
    ]), makeFakeBridge());
    expect(r.file.steps_executed[0].retry_count).toBe(0);
  });
});

describe('run variables', () => {
  test('a captured value reaches value_matches_variable', async () => {
    const b = makeFakeBridge({ elements: [[el('Total: 5')]] });
    const r = await exec(scenarioOf(
      [{ id: 'cap', action: 'capture_value', description: 'd', target: 'Total', capture_to: 'total' }],
      {
        variables: { total: { type: 'string', description: 'the total' } },
        assertions: [{ id: 'same', after_step: 'cap', type: 'value_matches_variable', description: 'd', element_description: 'Total', variable_name: 'total' }],
      }
    ), b);
    expect(r.file.assertion_results[0]).toMatchObject({ assertion_id: 'same', status: 'passed' });
    expect(r.file.captured_variables).toEqual({ total: 'Total: 5' });
  });
});

describe('every supported action', () => {
  test('a scenario using each one runs end to end on the fake bridge', async () => {
    const screen = [el('Go', { center: [1, 1] }), el('Total: 5'), el('Footer')];
    const b = makeFakeBridge({ elements: [screen], platform: 'android' });
    const steps = [
      { id: 'launch', action: 'launch_app' },
      { id: 'tap', action: 'tap', target: 'Go' },
      { id: 'type', action: 'type', value: 'hi' },
      { id: 'long', action: 'long_press', target: 'Go' },
      { id: 'dbl', action: 'double_tap', target: 'Go' },
      { id: 'swipe', action: 'swipe', value: 'up' },
      { id: 'btn', action: 'press_button', value: 'home' },
      { id: 'url', action: 'open_url', value: 'https://example.com' },
      { id: 'scroll', action: 'scroll_to_element', target: 'Footer' },
      { id: 'wait', action: 'wait_for_element', target: 'Go' },
      { id: 'gone', action: 'wait_for_element_gone', target: 'Nothing here' },
      { id: 'loading', action: 'wait_for_loading_complete' },
      { id: 'cap', action: 'capture_value', target: 'Total', capture_to: 'total' },
      { id: 'back', action: 'press_back' },
      { id: 'kbd', action: 'dismiss_keyboard' },
    ].map((s) => ({ description: 'd', ...s }));
    const r = await exec(
      scenarioOf(steps, {
        variables: { total: { type: 'string', description: 't' } },
        preconditions: { device_actions: [
          { action: 'uninstall_app' }, { action: 'install_app', value: '/tmp/a.apk' }, { action: 'set_orientation', value: 'portrait' },
        ] },
      }),
      b
    );
    expect(r.failures).toEqual([]);
    expect(r.file.steps_executed.every((s) => s.status === 'passed' && !s.needs_agent)).toBe(true);
    expect(r.file.steps_executed).toHaveLength(steps.length + 3);
    expect(r.finalized.status).toBe('passed');
  });
});
