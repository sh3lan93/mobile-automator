'use strict';

// The in-process runner behind `mauto run`, ported case for case from the
// real-device harness's executor tests (tests/unit/e2e-harness/executor.test.js).
// The harness drove `mauto` subprocesses; the runner drives a DeviceBridge and
// a ResultStore directly, so these tests use a scripted fake bridge and a real
// ResultStore on a temp workspace, and assert on the result file it writes.

const fs = require('fs');
const os = require('os');
const path = require('path');

const evaluator = require('../../../src/assertion/evaluator');
const catalog = require('../../../src/device/action-catalog');
const { ResultStore } = require('../../../src/result/store');
const { workspaceDir } = require('../../../src/workspace/layout');
const { runScenario } = require('../../../src/run/runner');
const { makeFakeBridge, makeFakeClock, homeElements, el } = require('../../helpers/fake-bridge');

const RUN_ID = 'run_20261021_120000';

function scenario(steps, assertions = []) {
  return {
    $schema_version: '2.1',
    scenario_id: 'demo',
    app_package: 'com.example.app',
    steps,
    assertions,
  };
}

let projectRoot;
beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-run-'));
});
afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

async function exec(sc, bridge, extra = {}) {
  const store = new ResultStore({ runId: RUN_ID, scenarioId: sc.scenario_id, projectRoot });
  const traced = [];
  const r = await runScenario({
    scenario: sc,
    bridge,
    store,
    evaluator,
    catalog,
    projectRoot,
    runId: RUN_ID,
    clock: makeFakeClock(),
    trace: (event, fields) => traced.push({ event, fields }),
    ...extra,
  });
  // What the runner recorded, before anything finalizes it.
  const file = JSON.parse(fs.readFileSync(store.file, 'utf8'));
  // The run status is not the runner's to decide: finalize derives it from
  // the records (deriveRunStatus), exactly as finalizeRun does for `mauto run`.
  const finalized = store.finalize();
  return { outcome: r, ...r, file, finalized, traced, store };
}

describe('runScenario', () => {
  // executor: "launch_app launches the app package, then gates on a non-empty element list"
  test('launch_app cold-starts the app package, then gates on a non-empty element list', async () => {
    const b = makeFakeBridge({ elements: [[], [], homeElements()] });
    const r = await exec(scenario([{ id: 'launch', action: 'launch_app', description: 'd' }]), b);
    expect(r.finalized.status).toBe('passed');
    expect(b.calls[0]).toEqual({ method: 'restartApp', args: ['com.example.app'] });
    expect(b.of('listElements')).toHaveLength(3);
  });

  // executor: "launch_app with cold %s passes --resume only when cold === false"
  test.each([
    ['absent', {}, 'restartApp'],
    ['true', { cold: true }, 'restartApp'],
    ['false', { cold: false }, 'launchApp'],
  ])('launch_app with cold %s resumes only when cold === false', async (_label, extra, method) => {
    const b = makeFakeBridge({ elements: [homeElements()] });
    const r = await exec(scenario([{ id: 'launch', action: 'launch_app', description: 'd', ...extra }]), b);
    expect(r.finalized.status).toBe('passed');
    expect(b.calls[0]).toEqual({ method, args: ['com.example.app'] });
    expect(b.methods()).not.toContain(method === 'launchApp' ? 'restartApp' : 'launchApp');
  });

  // executor: "drift gate: zero elements after a successful launch fails with the drift message, never "not found""
  test('drift gate: zero elements after a successful launch fails with the drift message, never "not found"', async () => {
    const b = makeFakeBridge({ elements: [[]] });
    const r = await exec(scenario([{ id: 'launch', action: 'launch_app', description: 'd' }]), b);
    expect(r.finalized.status).toBe('failed');
    expect(r.failures.join('\n')).toContain('engine returned zero elements after a successful launch of com.example.app');
    expect(r.failures.join('\n')).not.toMatch(/not found/i);
    expect(r.file.steps_executed).toHaveLength(1);
    expect(r.file.steps_executed[0].status).toBe('failed');
    expect(r.file.steps_executed[0].error_message).toContain('zero elements');
  });

  // executor: "the drift gate is not retried: a retry_policy cannot paper over it"
  test('the drift gate is not retried: a retry_policy cannot paper over it', async () => {
    const b = makeFakeBridge({ elements: [[]] });
    const r = await exec(
      scenario([{ id: 'launch', action: 'launch_app', description: 'd', on_failure: 'retry', retry_policy: { max_attempts: 3, backoff_ms: 10 } }]),
      b
    );
    expect(b.of('restartApp')).toHaveLength(1);
    expect(r.file.steps_executed[0].retry_count).toBe(0);
  });

  // executor: "tap resolves the target through the CLI matcher and taps its center"
  test('tap resolves the target through the CLI matcher and taps its center', async () => {
    const elements = homeElements();
    const more = elements.find((e) => evaluator.matches(e, 'More'));
    const b = makeFakeBridge({ elements: [elements] });
    const r = await exec(scenario([{ id: 'tap_more', action: 'tap', description: 'd', target: 'More' }]), b);
    expect(r.finalized.status).toBe('passed');
    expect(b.of('tap')).toEqual([{ method: 'tap', args: [{ x: more.center[0], y: more.center[1] }] }]);
  });

  // executor: "tap on a missing target fails the step and lists what was on screen"
  test('tap on a missing target fails the step and lists what was on screen', async () => {
    const b = makeFakeBridge({ elements: [[el('Sample Shop')]] });
    const r = await exec(scenario([{ id: 'tap_x', action: 'tap', description: 'd', target: 'Checkout' }]), b);
    expect(r.finalized.status).toBe('failed');
    expect(r.failures.join('\n')).toContain('Sample Shop');
    expect(b.methods()).not.toContain('tap');
  });

  // executor: "wait_for_element polls until the target appears"
  test('wait_for_element polls until the target appears', async () => {
    const b = makeFakeBridge({ elements: [[el('Loading')], [el('Loading')], [el('Sample Shop')]] });
    const r = await exec(
      scenario([{ id: 'wait_home', action: 'wait_for_element', description: 'd', target: 'Sample Shop', wait_config: { type: 'element_visible', timeout_ms: 30000 } }]),
      b
    );
    expect(r.finalized.status).toBe('passed');
    expect(b.of('listElements')).toHaveLength(3);
  });

  // executor: "wait_for_element times out at wait_config.timeout_ms"
  test('wait_for_element times out at wait_config.timeout_ms', async () => {
    const b = makeFakeBridge({ elements: [[el('Loading')]] });
    const r = await exec(
      scenario([{ id: 'wait_home', action: 'wait_for_element', description: 'd', target: 'Sample Shop', wait_config: { type: 'element_visible', timeout_ms: 3000 } }]),
      b
    );
    expect(r.finalized.status).toBe('failed');
    expect(r.failures.join('\n')).toMatch(/timed out after 3000ms: no element matches target "Sample Shop"/);
    // 3000ms at a 1500ms poll: t=0, 1500, 3000.
    expect(b.of('listElements')).toHaveLength(3);
  });

  // executor: "type sends the step value; semantic actions go through press"
  test('type sends the step value; semantic actions go through pressSemantic', async () => {
    const b = makeFakeBridge({ platform: 'android' });
    const r = await exec(
      scenario([
        { id: 'type_q', action: 'type', description: 'd', value: 'zzzz' },
        { id: 'hide', action: 'dismiss_keyboard', description: 'd' },
        { id: 'back', action: 'press_back', description: 'd' },
      ]),
      b
    );
    expect(r.finalized.status).toBe('passed');
    const input = b.calls.filter((c) => c.method !== 'getPlatform');
    expect(input).toEqual([
      { method: 'type', args: ['zzzz'] },
      { method: 'pressButton', args: ['BACK'] },
      { method: 'pressButton', args: ['BACK'] },
    ]);
  });

  // executor: "an action the harness does not implement is a step error, not a silent pass"
  test('an action the runner does not implement is a step error, not a silent pass', async () => {
    const b = makeFakeBridge();
    const r = await exec(
      scenario([{ id: 'swipe_up', action: 'swipe', description: 'd', value: 'up', on_failure: 'retry', retry_policy: { max_attempts: 3 } }]),
      b
    );
    expect(r.finalized.status).toBe('failed');
    expect(r.failures.join('\n')).toContain('action "swipe" is not supported by mauto run yet');
    expect(r.file.steps_executed[0].retry_count).toBe(0);
    // Nothing reached the device except the failure evidence.
    expect(b.methods()).toEqual(['screenshot']);
  });

  // executor: "retry_policy: retries with backoff and records the attempt count on pass"
  test('retry_policy: retries with backoff and records the attempt count on pass', async () => {
    const clock = makeFakeClock();
    const b = makeFakeBridge({
      elements: [[el('Home')]],
      methods: {
        tap: (_args, n) => {
          if (n < 3) throw new Error('flaky device');
          return null;
        },
      },
    });
    const r = await exec(
      scenario([{ id: 'tap_home', action: 'tap', description: 'd', target: 'Home', on_failure: 'retry', retry_policy: { max_attempts: 3, backoff_ms: 500 } }]),
      b,
      { clock }
    );
    expect(r.finalized.status).toBe('passed');
    expect(r.file.steps_executed[0]).toMatchObject({ status: 'passed', retried: true, retry_count: 2 });
    // Two backoffs of 500ms between three attempts.
    expect(clock.now()).toBe(1000);
  });

  // executor: "stops after the first failed step and still finalizes as failed"
  test('stops after the first failed step and reports the run failed', async () => {
    const b = makeFakeBridge({
      elements: [[el('Home')]],
      methods: { tap: () => { throw new Error('tap broke'); } },
    });
    const r = await exec(
      scenario([
        { id: 'tap_home', action: 'tap', description: 'd', target: 'Home' },
        { id: 'type_q', action: 'type', description: 'd', value: 'never' },
      ]),
      b
    );
    expect(r.finalized.status).toBe('failed');
    expect(r.failedStep).toBe('tap_home');
    expect(r.failures.join('\n')).toContain('tap broke');
    expect(b.methods()).not.toContain('type');
    expect(r.file.steps_executed.map((s) => s.step_id)).toEqual(['tap_home']);
    // A failed step always gets evidence, checkpoint or not.
    const rel = path.relative(projectRoot, path.join(workspaceDir(projectRoot), 'screenshots', 'demo', RUN_ID, 'step_tap_home_failure.png'));
    expect(r.file.steps_executed[0].screenshot).toBe(rel);
    // The runner records; finalize belongs to the CLI (finalizeRun).
    expect(r.file).not.toHaveProperty('status');
  });

  // executor: "checkpoint captures a screenshot under screenshots/<scenario>/<run>/ and records it"
  test('checkpoint captures a screenshot under screenshots/<scenario>/<run>/ and records it', async () => {
    const b = makeFakeBridge({ elements: [[el('Home')]] });
    await exec(scenario([{ id: 'tap_home', action: 'tap', description: 'd', target: 'Home', checkpoint: true }]), b);
    const abs = path.join(workspaceDir(projectRoot), 'screenshots', 'demo', RUN_ID, 'step_tap_home.png');
    expect(b.of('screenshot')).toEqual([{ method: 'screenshot', args: [abs] }]);
    expect(fs.existsSync(abs)).toBe(true);
    const r = JSON.parse(fs.readFileSync(path.join(workspaceDir(projectRoot), 'results', `${RUN_ID}.json`), 'utf8'));
    expect(r.steps_executed[0].screenshot).toBe(path.relative(projectRoot, abs));
  });

  test('a failed screenshot is logged, not fatal', async () => {
    const lines = [];
    const b = makeFakeBridge({
      elements: [[el('Home')]],
      methods: { screenshot: () => { throw new Error('no disk'); } },
    });
    const r = await exec(scenario([{ id: 'tap_home', action: 'tap', description: 'd', target: 'Home', checkpoint: true }]), b, {
      log: (l) => lines.push(l),
    });
    expect(r.finalized.status).toBe('passed');
    expect(r.file.steps_executed[0].screenshot).toBeNull();
    expect(lines.join('\n')).toContain('no disk');
  });

  // executor: "assertions run after their step via assert, then add-assertion records the verdict"
  test('assertions run after their step through the evaluator, and the verdict is recorded', async () => {
    const b = makeFakeBridge({ elements: [[el('More'), el('No products match your search')]] });
    const r = await exec(
      scenario(
        [{ id: 'tap_more', action: 'tap', description: 'd', target: 'More' }],
        [
          { id: 'more_header', after_step: 'tap_more', type: 'element_text', description: 'd', element_description: 'More', expected_value: 'More' },
          { id: 'no_results', after_step: 'tap_more', type: 'text_contains', description: 'd', expected_substring: 'No products match' },
        ]
      ),
      b
    );
    expect(r.finalized.status).toBe('passed');
    expect(r.file.assertion_results).toEqual([
      expect.objectContaining({ assertion_id: 'more_header', status: 'passed', expected: 'More', message: "Element 'More' text equals 'More'." }),
      expect.objectContaining({ assertion_id: 'no_results', status: 'passed', expected: 'No products match' }),
    ]);
    // The step is recorded before its assertions, which read the screen after it.
    expect(b.methods()).toEqual(['listElements', 'tap', 'listElements', 'listElements']);
  });

  // executor: "a failed assertion fails the scenario without stopping later steps"
  test('a failed assertion fails the scenario without stopping later steps', async () => {
    const b = makeFakeBridge({ elements: [[el('More', { text: 'Mehr', accessibility_label: 'More' })]] });
    const r = await exec(
      scenario(
        [
          { id: 'tap_more', action: 'tap', description: 'd', target: 'More' },
          { id: 'hide', action: 'dismiss_keyboard', description: 'd' },
        ],
        [{ id: 'hdr', after_step: 'tap_more', type: 'element_text', description: 'd', element_description: 'More', expected_value: 'More' }]
      ),
      b
    );
    expect(r.finalized.status).toBe('failed');
    // Failed on an assertion, not a step.
    expect(r.failedStep).toBeNull();
    expect(b.methods()).toContain('pressButton');
    expect(r.file.assertion_results[0].status).toBe('failed');
    expect(r.failures.join('\n')).toContain('hdr');
  });

  // executor: "a Tier-2 assertion the CLI cannot decide is recorded as a failure"
  test('a Tier-2 assertion the evaluator cannot decide is recorded as a failure', async () => {
    const b = makeFakeBridge();
    const r = await exec(
      scenario(
        [{ id: 'hide', action: 'dismiss_keyboard', description: 'd' }],
        [{ id: 'looks', after_step: 'hide', type: 'visual_state', description: 'd', expected_visual_state: 'x' }]
      ),
      b
    );
    expect(r.finalized.status).toBe('failed');
    expect(r.file.assertion_results[0].status).toBe('failed');
    expect(r.file.assertion_results[0].message).toMatch(/^needs agent judgment; mauto run decides only mechanical assertions/);
  });

  // executor: "every verb carries MAUTO_RUN_ID so the run has a trace"
  test('the run is traced: run.start first, then one run.step per recorded step', async () => {
    const b = makeFakeBridge({ elements: [[el('Home')]], methods: { tap: () => { throw new Error('tap broke'); } } });
    const r = await exec(
      scenario([
        { id: 'hide', action: 'dismiss_keyboard', description: 'd' },
        { id: 'tap_home', action: 'tap', description: 'd', target: 'Home' },
        { id: 'never', action: 'press_back', description: 'd' },
      ]),
      b
    );
    expect(r.traced).toEqual([
      { event: 'run.start', fields: undefined },
      { event: 'run.step', fields: { ok: true } },
      { event: 'run.step', fields: { ok: false } },
    ]);
  });

  // executor: "assert and finalize accept test_failed; every other verb accepts nothing"
  test('a failed mechanical assertion is persisted as a failed verdict, not thrown', async () => {
    const b = makeFakeBridge({ elements: [[el('Other')]] });
    const r = await exec(
      scenario(
        [{ id: 'hide', action: 'dismiss_keyboard', description: 'd' }],
        [{ id: 'gone', after_step: 'hide', type: 'element_exists', description: 'd', element_description: 'More' }]
      ),
      b
    );
    expect(r.file.assertion_results).toEqual([
      expect.objectContaining({ assertion_id: 'gone', status: 'failed', expected: null }),
    ]);
  });

  // executor: "a failed-assert verdict returned through the accepted path is recorded as --pass false"
  test('a mechanical false verdict is recorded failed with the evaluator message', async () => {
    const b = makeFakeBridge({ elements: [[el('X', { accessibility_label: 'More' })]] });
    const r = await exec(
      scenario(
        [{ id: 'tap_more', action: 'tap', description: 'd', target: 'More' }],
        [{ id: 'hdr', after_step: 'tap_more', type: 'element_text', description: 'd', element_description: 'More', expected_value: 'More' }]
      ),
      b
    );
    expect(r.finalized.status).toBe('failed');
    expect(r.file.assertion_results[0]).toMatchObject({ status: 'failed', message: "Element 'More' text is 'X', expected 'More'." });
  });

  test('an evaluator that throws records the assertion failed as errored', async () => {
    const b = makeFakeBridge();
    const broken = { ...evaluator, evaluate: () => { throw new Error('boom'); } };
    const r = await exec(
      scenario(
        [{ id: 'hide', action: 'dismiss_keyboard', description: 'd' }],
        [{ id: 'a', after_step: 'hide', type: 'element_exists', description: 'd', element_description: 'More' }]
      ),
      b,
      { evaluator: broken }
    );
    expect(r.finalized.status).toBe('failed');
    expect(r.file.assertion_results[0]).toMatchObject({ status: 'failed', message: 'assertion errored: boom' });
  });

  // executor: "returns the result file path under the workspace"
  test('records into the store it was given: results/<run_id>.json under the workspace', async () => {
    const r = await exec(scenario([{ id: 'hide', action: 'dismiss_keyboard', description: 'd' }]), makeFakeBridge());
    expect(r.store.file).toBe(path.join(workspaceDir(projectRoot), 'results', `${RUN_ID}.json`));
    expect(r.file.run_id).toBe(RUN_ID);
    expect(r.outcome).toEqual({ failures: [], failedStep: null });
    expect(r.finalized.status).toBe('passed');
  });
});

// executor: describe('makeRunId') — the id format now lives in src/run/run-id.js
// and is covered by tests/unit/run/run-id.test.js.
