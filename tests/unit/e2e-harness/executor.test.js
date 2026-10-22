'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const evaluator = require('../../../src/assertion/evaluator');
const { runScenario, makeRunId } = require('../../../sample-app/scripts/lib/executor');
const { homeElements, el } = require('./fixtures');

const RUN_ID = 'run_20261021_120000';

// A fake `mauto` that records every verb call and answers from `handlers`
// keyed by verb ('elements', 'tap', 'result add-step', ...). A handler may
// return data or throw; unhandled verbs answer null. An array handler is a
// queue of answers: each call shifts one, the last one repeats.
function fakeMauto(handlers = {}) {
  const calls = [];
  const run = (args, opts = {}) => {
    const verb = args[0] === 'result' ? `result ${args[1]}` : args[0];
    calls.push({ verb, args, env: opts.env || {} });
    const h = handlers[verb];
    if (Array.isArray(h)) return Promise.resolve(h.length > 1 ? h.shift() : h[0]);
    if (typeof h === 'function') {
      try {
        return Promise.resolve(h(args, calls.filter((c) => c.verb === verb).length));
      } catch (e) {
        return Promise.reject(e);
      }
    }
    return Promise.resolve(h === undefined ? null : h);
  };
  return { run, calls, verbs: () => calls.map((c) => c.verb) };
}

// A fake clock: sleep advances time instantly.
function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: (ms) => { t += ms; return Promise.resolve(); } };
}

function scenario(steps, assertions = []) {
  return {
    $schema_version: '2.1',
    scenario_id: 'demo',
    app_package: 'com.example.app',
    steps,
    assertions,
  };
}

let workspaceDir;
beforeEach(() => {
  workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-exec-'));
});
afterEach(() => {
  fs.rmSync(workspaceDir, { recursive: true, force: true });
});

function exec(sc, mauto, extra = {}) {
  const clock = fakeClock();
  return runScenario({
    scenario: sc,
    mauto,
    evaluator,
    workspaceDir,
    runId: RUN_ID,
    sleep: clock.sleep,
    now: clock.now,
    log: () => {},
    ...extra,
  });
}

const argAfter = (args, flag) => args[args.indexOf(flag) + 1];

describe('makeRunId', () => {
  test('formats run_YYYYMMDD_HHMMSS in UTC', () => {
    expect(makeRunId(new Date(Date.UTC(2026, 9, 21, 7, 5, 9)))).toBe('run_20261021_070509');
  });
});

describe('runScenario', () => {
  test('launch_app launches the app package, then gates on a non-empty element list', async () => {
    const m = fakeMauto({ elements: [[], [], homeElements()] });
    const r = await exec(scenario([{ id: 'launch', action: 'launch_app', description: 'd' }]), m);
    expect(r.status).toBe('passed');
    expect(m.calls[0].args).toEqual(['launch', 'com.example.app']);
    expect(m.verbs().filter((v) => v === 'elements')).toHaveLength(3);
  });

  // #255: mauto launch cold-starts by default; only cold: false asks it to resume.
  test.each([
    ['absent', {}, ['launch', 'com.example.app']],
    ['true', { cold: true }, ['launch', 'com.example.app']],
    ['false', { cold: false }, ['launch', 'com.example.app', '--resume']],
  ])('launch_app with cold %s passes --resume only when cold === false', async (_label, extra, args) => {
    const m = fakeMauto({ elements: [homeElements()] });
    const r = await exec(scenario([{ id: 'launch', action: 'launch_app', description: 'd', ...extra }]), m);
    expect(r.status).toBe('passed');
    expect(m.calls[0].args).toEqual(args);
  });

  test('drift gate: zero elements after a successful launch fails with the drift message, never "not found"', async () => {
    const m = fakeMauto({ elements: [[]] });
    const r = await exec(scenario([{ id: 'launch', action: 'launch_app', description: 'd' }]), m);
    expect(r.status).toBe('failed');
    expect(r.failures.join('\n')).toContain('engine returned zero elements after a successful launch');
    expect(r.failures.join('\n')).not.toMatch(/not found/i);
    const step = m.calls.find((c) => c.verb === 'result add-step');
    expect(argAfter(step.args, '--status')).toBe('fail');
    expect(argAfter(step.args, '--error-message')).toContain('zero elements');
  });

  test('the drift gate is not retried: a retry_policy cannot paper over it', async () => {
    const m = fakeMauto({ elements: [[]] });
    await exec(
      scenario([{ id: 'launch', action: 'launch_app', description: 'd', on_failure: 'retry', retry_policy: { max_attempts: 3, backoff_ms: 10 } }]),
      m
    );
    expect(m.verbs().filter((v) => v === 'launch')).toHaveLength(1);
  });

  test('tap resolves the target through the CLI matcher and taps its center', async () => {
    const elements = homeElements();
    const more = elements.find((e) => evaluator.matches(e, 'More'));
    const m = fakeMauto({ elements: [elements] });
    const r = await exec(scenario([{ id: 'tap_more', action: 'tap', description: 'd', target: 'More' }]), m);
    expect(r.status).toBe('passed');
    const tap = m.calls.find((c) => c.verb === 'tap');
    expect(tap.args).toEqual(['tap', '--at', `${more.center[0]},${more.center[1]}`]);
  });

  test('tap on a missing target fails the step and lists what was on screen', async () => {
    const m = fakeMauto({ elements: [[el('Sample Shop')]] });
    const r = await exec(scenario([{ id: 'tap_x', action: 'tap', description: 'd', target: 'Checkout' }]), m);
    expect(r.status).toBe('failed');
    expect(r.failures.join('\n')).toContain('Sample Shop');
    expect(m.verbs()).not.toContain('tap');
  });

  test('wait_for_element polls until the target appears', async () => {
    const m = fakeMauto({ elements: [[el('Loading')], [el('Loading')], [el('Sample Shop')]] });
    const r = await exec(
      scenario([{ id: 'wait_home', action: 'wait_for_element', description: 'd', target: 'Sample Shop', wait_config: { type: 'element_visible', timeout_ms: 30000 } }]),
      m
    );
    expect(r.status).toBe('passed');
    expect(m.verbs().filter((v) => v === 'elements')).toHaveLength(3);
  });

  test('wait_for_element times out at wait_config.timeout_ms', async () => {
    const m = fakeMauto({ elements: [[el('Loading')]] });
    const r = await exec(
      scenario([{ id: 'wait_home', action: 'wait_for_element', description: 'd', target: 'Sample Shop', wait_config: { type: 'element_visible', timeout_ms: 3000 } }]),
      m
    );
    expect(r.status).toBe('failed');
    expect(r.failures.join('\n')).toMatch(/3000ms/);
    // 3000ms at a 1500ms poll: t=0, 1500, 3000.
    expect(m.verbs().filter((v) => v === 'elements')).toHaveLength(3);
  });

  test('type sends the step value; semantic actions go through press', async () => {
    const m = fakeMauto();
    const r = await exec(
      scenario([
        { id: 'type_q', action: 'type', description: 'd', value: 'zzzz' },
        { id: 'hide', action: 'dismiss_keyboard', description: 'd' },
        { id: 'back', action: 'press_back', description: 'd' },
      ]),
      m
    );
    expect(r.status).toBe('passed');
    const device = m.calls.filter((c) => !c.verb.startsWith('result'));
    expect(device.map((c) => c.args)).toEqual([['type', 'zzzz'], ['press', 'dismiss_keyboard'], ['press', 'press_back']]);
  });

  test('an action the harness does not implement is a step error, not a silent pass', async () => {
    const m = fakeMauto();
    const r = await exec(scenario([{ id: 'swipe_up', action: 'swipe', description: 'd', value: 'up' }]), m);
    expect(r.status).toBe('failed');
    expect(r.failures.join('\n')).toContain('unsupported by the E2E harness');
  });

  test('retry_policy: retries with backoff and records the attempt count on pass', async () => {
    const m = fakeMauto({
      tap: (_args, n) => {
        if (n < 3) throw new Error('flaky device');
        return null;
      },
      elements: [[el('Home')]],
    });
    const r = await exec(
      scenario([{ id: 'tap_home', action: 'tap', description: 'd', target: 'Home', on_failure: 'retry', retry_policy: { max_attempts: 3, backoff_ms: 500 } }]),
      m
    );
    expect(r.status).toBe('passed');
    const step = m.calls.find((c) => c.verb === 'result add-step');
    expect(argAfter(step.args, '--status')).toBe('pass');
    expect(argAfter(step.args, '--attempts')).toBe('3');
  });

  test('stops after the first failed step and still finalizes as failed', async () => {
    const m = fakeMauto({ elements: [[el('Home')]], tap: () => { throw new Error('tap broke'); } });
    const r = await exec(
      scenario([
        { id: 'tap_home', action: 'tap', description: 'd', target: 'Home' },
        { id: 'type_q', action: 'type', description: 'd', value: 'never' },
      ]),
      m
    );
    expect(r.status).toBe('failed');
    expect(r.failedStep).toBe('tap_home');
    expect(r.failures.join('\n')).toContain('tap broke');
    expect(m.verbs()).not.toContain('type');
    const steps = m.calls.filter((c) => c.verb === 'result add-step');
    expect(steps).toHaveLength(1);
    const fin = m.calls.find((c) => c.verb === 'result finalize');
    expect(argAfter(fin.args, '--status')).toBe('failed');
    expect(argAfter(fin.args, '--run-id')).toBe(RUN_ID);
    expect(argAfter(fin.args, '--scenario-id')).toBe('demo');
  });

  test('checkpoint captures a screenshot under screenshots/<scenario>/<run>/ and records it', async () => {
    const m = fakeMauto({ elements: [[el('Home')]] });
    await exec(scenario([{ id: 'tap_home', action: 'tap', description: 'd', target: 'Home', checkpoint: true }]), m);
    const shot = m.calls.find((c) => c.verb === 'screenshot');
    const rel = path.join('mobile-automator', 'screenshots', 'demo', RUN_ID, 'step_tap_home.png');
    expect(shot.args[1]).toBe(path.join(workspaceDir, rel));
    expect(fs.existsSync(path.dirname(shot.args[1]))).toBe(true);
    const step = m.calls.find((c) => c.verb === 'result add-step');
    expect(argAfter(step.args, '--screenshot')).toBe(rel);
  });

  test('assertions run after their step via assert, then add-assertion records the verdict', async () => {
    const m = fakeMauto({
      elements: [[el('More')]],
      assert: (args) => ({ type: args[1], mechanical: true, pass: true, needs_agent: false, message: 'ok it is' }),
    });
    const r = await exec(
      scenario(
        [{ id: 'tap_more', action: 'tap', description: 'd', target: 'More' }],
        [
          { id: 'more_header', after_step: 'tap_more', type: 'element_text', description: 'd', element_description: 'More', expected_value: 'More' },
          { id: 'no_results', after_step: 'tap_more', type: 'text_contains', description: 'd', expected_substring: 'No products match' },
        ]
      ),
      m
    );
    expect(r.status).toBe('passed');
    const asserts = m.calls.filter((c) => c.verb === 'assert').map((c) => c.args);
    expect(asserts).toEqual([
      ['assert', 'element_text', '--target', 'More', '--expected', 'More'],
      ['assert', 'text_contains', '--expected', 'No products match'],
    ]);
    const recorded = m.calls.filter((c) => c.verb === 'result add-assertion').map((c) => c.args);
    expect(recorded).toHaveLength(2);
    expect(argAfter(recorded[0], '--assertion-id')).toBe('more_header');
    expect(argAfter(recorded[0], '--step-id')).toBe('tap_more');
    expect(argAfter(recorded[0], '--type')).toBe('element_text');
    expect(argAfter(recorded[0], '--pass')).toBe('true');
    expect(argAfter(recorded[0], '--message')).toBe('ok it is');
    expect(argAfter(recorded[0], '--expected')).toBe('More');
    // The step is recorded before its assertions.
    const order = m.verbs().filter((v) => v.startsWith('result'));
    expect(order).toEqual(['result add-step', 'result add-assertion', 'result add-assertion', 'result finalize']);
  });

  test('a failed assertion fails the scenario without stopping later steps', async () => {
    const m = fakeMauto({
      elements: [[el('More')]],
      assert: () => ({ type: 'element_text', mechanical: true, pass: false, needs_agent: false, message: 'text is X' }),
    });
    const r = await exec(
      scenario(
        [
          { id: 'tap_more', action: 'tap', description: 'd', target: 'More' },
          { id: 'hide', action: 'dismiss_keyboard', description: 'd' },
        ],
        [{ id: 'hdr', after_step: 'tap_more', type: 'element_text', description: 'd', element_description: 'More', expected_value: 'More' }]
      ),
      m
    );
    expect(r.status).toBe('failed');
    // Failed on an assertion, not a step.
    expect(r.failedStep).toBeNull();
    expect(m.verbs()).toContain('press');
    expect(argAfter(m.calls.find((c) => c.verb === 'result add-assertion').args, '--pass')).toBe('false');
    expect(r.failures.join('\n')).toContain('hdr');
  });

  test('a Tier-2 assertion the CLI cannot decide is recorded as a failure', async () => {
    const m = fakeMauto({
      assert: () => ({ type: 'visual_state', mechanical: false, pass: null, needs_agent: true, message: 'agent must judge' }),
    });
    const r = await exec(
      scenario(
        [{ id: 'hide', action: 'dismiss_keyboard', description: 'd' }],
        [{ id: 'looks', after_step: 'hide', type: 'visual_state', description: 'd', expected_visual_state: 'x' }]
      ),
      m
    );
    expect(r.status).toBe('failed');
    expect(argAfter(m.calls.find((c) => c.verb === 'result add-assertion').args, '--pass')).toBe('false');
  });

  test('every verb carries MAUTO_RUN_ID so the run has a trace', async () => {
    const m = fakeMauto();
    await exec(scenario([{ id: 'hide', action: 'dismiss_keyboard', description: 'd' }]), m);
    expect(m.calls.length).toBeGreaterThan(0);
    for (const c of m.calls) expect(c.env.MAUTO_RUN_ID).toBe(RUN_ID);
  });

  test('returns the result file path under the workspace', async () => {
    const r = await exec(scenario([{ id: 'hide', action: 'dismiss_keyboard', description: 'd' }]), fakeMauto());
    expect(r.resultPath).toBe(path.join(workspaceDir, 'mobile-automator', 'results', `${RUN_ID}.json`));
  });
});
