'use strict';

// The per-action handlers of `mauto run` (src/run/actions/), each driven
// against the scripted fake bridge. Handler contract: `handler(step, ctx)`
// resolves on success, throws on failure; a throw carrying `fatal: true` is
// never retried by runStep.

const evaluator = require('../../../src/assertion/evaluator');
const catalog = require('../../../src/device/action-catalog');
const { ACTION_HANDLERS, handlerFor } = require('../../../src/run/actions');
const { launchApp } = require('../../../src/run/actions/launch');
const { tap, type } = require('../../../src/run/actions/gestures');
const { waitForElement } = require('../../../src/run/actions/wait');
const { SEMANTIC_ACTIONS } = require('../../../src/device/semantic-press');
const { makeFakeBridge, makeFakeClock, el } = require('../../helpers/fake-bridge');

function ctxFor(bridge, extra = {}) {
  return {
    scenario: { scenario_id: 'demo', app_package: 'com.example.app' },
    bridge,
    evaluator,
    catalog,
    clock: makeFakeClock(),
    log: () => {},
    ...extra,
  };
}

describe('ACTION_HANDLERS', () => {
  test('covers exactly the R1 actions', () => {
    expect(Object.keys(ACTION_HANDLERS).sort()).toEqual(
      ['launch_app', 'tap', 'type', 'wait_for_element', ...SEMANTIC_ACTIONS].sort()
    );
  });

  test('every key is a scenario-schema action in the action catalog', () => {
    for (const action of Object.keys(ACTION_HANDLERS)) expect(catalog.ACTION_CATALOG).toHaveProperty(action);
  });

  test('an action outside the map gets a fatal handler naming it', async () => {
    const b = makeFakeBridge();
    const err = await handlerFor('swipe')({ id: 's', action: 'swipe' }, ctxFor(b)).catch((e) => e);
    expect(err.message).toBe('action "swipe" is not supported by mauto run yet');
    expect(err.fatal).toBe(true);
    expect(b.calls).toEqual([]);
  });

  test('a prototype key is not mistaken for a handler', async () => {
    const err = await handlerFor('toString')({ id: 's', action: 'toString' }, ctxFor(makeFakeBridge())).catch((e) => e);
    expect(err.fatal).toBe(true);
  });
});

describe('launch_app', () => {
  test('cold start by default goes through restartApp', async () => {
    const b = makeFakeBridge({ elements: [[el('Home')]] });
    await launchApp({ id: 'l', action: 'launch_app' }, ctxFor(b));
    expect(b.methods()).toEqual(['restartApp', 'listElements']);
    expect(b.calls[0].args).toEqual(['com.example.app']);
  });

  test('cold: false resumes through launchApp', async () => {
    const b = makeFakeBridge({ elements: [[el('Home')]] });
    await launchApp({ id: 'l', action: 'launch_app', cold: false }, ctxFor(b));
    expect(b.methods()).toEqual(['launchApp', 'listElements']);
  });

  test('zero elements until the timeout is a fatal drift error', async () => {
    const b = makeFakeBridge({ elements: [[]] });
    const err = await launchApp({ id: 'l', action: 'launch_app', wait_config: { timeout_ms: 3000 } }, ctxFor(b)).catch((e) => e);
    expect(err.fatal).toBe(true);
    expect(err.message).toBe(
      'engine returned zero elements after a successful launch of com.example.app ' +
        '(waited 3000ms): the element response shape drifted or the app did not render'
    );
    expect(b.of('listElements')).toHaveLength(3);
  });

  test('a launch the device refuses propagates as a retryable error', async () => {
    const b = makeFakeBridge({ methods: { restartApp: () => { throw new Error('no such app'); } } });
    const err = await launchApp({ id: 'l', action: 'launch_app' }, ctxFor(b)).catch((e) => e);
    expect(err.message).toBe('no such app');
    expect(err.fatal).toBeUndefined();
  });
});

describe('tap', () => {
  test('taps the first match and warns when the target is ambiguous', async () => {
    const lines = [];
    const b = makeFakeBridge({ elements: [[el('Home', { center: [1, 2] }), el('Home again', { center: [3, 4] })]] });
    await tap({ id: 't', action: 'tap', target: 'Home' }, ctxFor(b, { log: (l) => lines.push(l) }));
    expect(b.of('tap')[0].args).toEqual([{ x: 1, y: 2 }]);
    expect(lines.join('\n')).toContain('matched 2 elements; using the first');
  });

  test('a missing target throws TargetNotFoundError (retryable)', async () => {
    const b = makeFakeBridge({ elements: [[el('Other')]] });
    const err = await tap({ id: 't', action: 'tap', target: 'Home' }, ctxFor(b)).catch((e) => e);
    expect(err.name).toBe('TargetNotFoundError');
    expect(err.fatal).toBeUndefined();
  });
});

describe('type', () => {
  test('types the value as a string', async () => {
    const b = makeFakeBridge();
    await type({ id: 'y', action: 'type', value: 42 }, ctxFor(b));
    expect(b.calls).toEqual([{ method: 'type', args: ['42'] }]);
  });

  test.each([undefined, null])('a step without a value (%s) is fatal', async (value) => {
    const b = makeFakeBridge();
    const err = await type({ id: 'y', action: 'type', value }, ctxFor(b)).catch((e) => e);
    expect(err.fatal).toBe(true);
    expect(err.message).toBe('type step has no value');
    expect(b.calls).toEqual([]);
  });
});

describe('semantic actions', () => {
  test.each(SEMANTIC_ACTIONS)('%s is resolved per platform through pressSemantic', async (action) => {
    const b = makeFakeBridge({ platform: 'android', elements: [[el('Allow'), el("Don't allow")]] });
    await ACTION_HANDLERS[action]({ id: 's', action }, ctxFor(b));
    expect(b.methods()[0]).toBe('getPlatform');
    expect(b.methods().some((m) => m === 'pressButton' || m === 'tap')).toBe(true);
  });

  test('on iOS press_back is the edge swipe', async () => {
    const b = makeFakeBridge({ platform: 'ios' });
    await ACTION_HANDLERS.press_back({ id: 's', action: 'press_back' }, ctxFor(b));
    expect(b.methods()).toEqual(['getPlatform', 'getScreenSize', 'swipe']);
  });
});

describe('wait_for_element', () => {
  test('resolves as soon as the target is on screen', async () => {
    const b = makeFakeBridge({ elements: [[el('Loading')], [el('Ready')]] });
    const clock = makeFakeClock();
    await waitForElement({ id: 'w', action: 'wait_for_element', target: 'Ready' }, ctxFor(b, { clock }));
    expect(b.of('listElements')).toHaveLength(2);
    expect(clock.now()).toBe(1500);
  });

  test('times out with the last miss in the message', async () => {
    const b = makeFakeBridge({ elements: [[el('Loading')]] });
    const err = await waitForElement(
      { id: 'w', action: 'wait_for_element', target: 'Ready', wait_config: { timeout_ms: 1000 } },
      ctxFor(b)
    ).catch((e) => e);
    expect(err.message).toBe('timed out after 1000ms: no element matches target "Ready"; on screen: "Loading"');
  });

  test('a non-TargetNotFound error is not swallowed by the poll', async () => {
    const b = makeFakeBridge({ methods: { listElements: () => { throw new Error('device gone'); } } });
    const err = await waitForElement({ id: 'w', action: 'wait_for_element', target: 'Ready' }, ctxFor(b)).catch((e) => e);
    expect(err.message).toBe('device gone');
  });
});
