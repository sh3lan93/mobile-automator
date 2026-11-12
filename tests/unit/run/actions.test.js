'use strict';

// The per-action handlers of `mauto run` (src/run/actions/), each driven
// against the scripted fake bridge. Handler contract: `handler(step, ctx)`
// resolves on success, throws on failure; a throw carrying `fatal: true` is
// never retried by runStep.

const evaluator = require('../../../src/assertion/evaluator');
const catalog = require('../../../src/device/action-catalog');
const { ACTION_HANDLERS, handlerFor } = require('../../../src/run/actions');
const { launchApp } = require('../../../src/run/actions/launch');
const { tap, type, longPress, doubleTap, swipe, pressButton, openUrl } = require('../../../src/run/actions/gestures');
const { waitForElement, waitForElementGone, waitForLoadingComplete } = require('../../../src/run/actions/wait');
const { scrollToElement } = require('../../../src/run/actions/scroll');
const { captureValue } = require('../../../src/run/actions/capture');
const { runSettings } = require('../../../src/run/settings');
const { SEMANTIC_ACTIONS } = require('../../../src/device/semantic-press');
const { makeFakeBridge, makeFakeClock, el } = require('../../helpers/fake-bridge');

function ctxFor(bridge, extra = {}) {
  return {
    scenario: { scenario_id: 'demo', app_package: 'com.example.app' },
    settings: runSettings(null),
    variables: {},
    store: { captureVariable: jest.fn() },
    bridge,
    evaluator,
    catalog,
    clock: makeFakeClock(),
    observe: () => {},
    ...extra,
  };
}

describe('ACTION_HANDLERS', () => {
  test('every key is a scenario-schema action in the action catalog', () => {
    for (const action of Object.keys(ACTION_HANDLERS)) expect(catalog.ACTION_CATALOG).toHaveProperty(action);
  });

  test('an action outside the map gets a fatal handler naming it', async () => {
    const b = makeFakeBridge();
    const err = await handlerFor('not_an_action')({ id: 's', action: 'not_an_action' }, ctxFor(b)).catch((e) => e);
    expect(err.message).toBe('action "not_an_action" is not supported by mauto run yet');
    expect(err.fatal).toBe(true);
    expect(b.calls).toEqual([]);
  });

  test('a prototype key is not mistaken for a handler', async () => {
    const err = await handlerFor('toString')({ id: 's', action: 'toString' }, ctxFor(makeFakeBridge())).catch((e) => e);
    expect(err.fatal).toBe(true);
  });

  test('the semantic actions are all mapped', () => {
    for (const action of SEMANTIC_ACTIONS) expect(ACTION_HANDLERS).toHaveProperty(action);
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
  test('taps the first match and observes that the target is ambiguous', async () => {
    const lines = [];
    const b = makeFakeBridge({ elements: [[el('Home', { center: [1, 2] }), el('Home again', { center: [3, 4] })]] });
    await tap({ id: 't', action: 'tap', target: 'Home' }, ctxFor(b, { observe: (l) => lines.push(l) }));
    expect(b.of('tap')[0].args).toEqual([{ x: 1, y: 2 }]);
    expect(lines).toEqual(['target "Home" matched 2 elements; used the first']);
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


describe('long_press', () => {
  test('long-presses the resolved target centre', async () => {
    const b = makeFakeBridge({ elements: [[el('Item', { center: [7, 8] })]] });
    await longPress({ id: 'l', action: 'long_press', target: 'Item' }, ctxFor(b));
    expect(b.of('longPress')[0].args).toEqual([{ x: 7, y: 8 }]);
  });

  test('a numeric value is the duration in ms', async () => {
    const b = makeFakeBridge({ elements: [[el('Item', { center: [7, 8] })]] });
    await longPress({ id: 'l', action: 'long_press', target: 'Item', value: 1200 }, ctxFor(b));
    expect(b.of('longPress')[0].args).toEqual([{ x: 7, y: 8, duration: 1200 }]);
  });

  test('a non-numeric value sends no duration', async () => {
    const b = makeFakeBridge({ elements: [[el('Item', { center: [7, 8] })]] });
    await longPress({ id: 'l', action: 'long_press', target: 'Item', value: 'long' }, ctxFor(b));
    expect(b.of('longPress')[0].args).toEqual([{ x: 7, y: 8 }]);
  });
});

describe('double_tap', () => {
  test('double-taps the resolved target centre', async () => {
    const b = makeFakeBridge({ elements: [[el('Item', { center: [3, 4] })]] });
    await doubleTap({ id: 'd', action: 'double_tap', target: 'Item' }, ctxFor(b));
    expect(b.of('doubleTap')[0].args).toEqual([{ x: 3, y: 4 }]);
  });
});

describe('swipe', () => {
  test.each(['up', 'down', 'left', 'right'])('swipes %s', async (direction) => {
    const b = makeFakeBridge();
    await swipe({ id: 's', action: 'swipe', value: direction }, ctxFor(b));
    expect(b.of('swipe')[0].args).toEqual([{ direction }]);
  });

  test.each([undefined, 'sideways', 5])('a bad direction (%s) is fatal', async (value) => {
    const b = makeFakeBridge();
    const err = await swipe({ id: 's', action: 'swipe', value }, ctxFor(b)).catch((e) => e);
    expect(err.fatal).toBe(true);
    expect(err.message).toMatch(/swipe step needs a direction/);
    expect(b.calls).toEqual([]);
  });
});

describe('press_button', () => {
  test('upper-cases the value', async () => {
    const b = makeFakeBridge();
    await pressButton({ id: 'p', action: 'press_button', value: 'home' }, ctxFor(b));
    expect(b.of('pressButton')[0].args).toEqual(['HOME']);
  });

  test('no value is fatal', async () => {
    const b = makeFakeBridge();
    const err = await pressButton({ id: 'p', action: 'press_button' }, ctxFor(b)).catch((e) => e);
    expect(err.fatal).toBe(true);
    expect(err.message).toBe('press_button step has no value');
  });
});

describe('open_url', () => {
  test('opens the url', async () => {
    const b = makeFakeBridge({ methods: { openUrl: () => null } });
    await openUrl({ id: 'u', action: 'open_url', value: 'https://example.com' }, ctxFor(b));
    expect(b.of('openUrl')[0].args).toEqual(['https://example.com']);
  });

  test('no value is fatal', async () => {
    const b = makeFakeBridge({ methods: { openUrl: () => null } });
    const err = await openUrl({ id: 'u', action: 'open_url' }, ctxFor(b)).catch((e) => e);
    expect(err.fatal).toBe(true);
    expect(err.message).toBe('open_url step has no value');
  });
});

describe('scroll_to_element', () => {
  const step = { id: 'sc', action: 'scroll_to_element', target: 'Footer' };

  test('found at once: no swipe', async () => {
    const b = makeFakeBridge({ elements: [[el('Footer')]] });
    await scrollToElement(step, ctxFor(b));
    expect(b.of('swipe')).toHaveLength(0);
  });

  test('found after k swipes', async () => {
    const b = makeFakeBridge({ elements: [[el('a')], [el('b')], [el('Footer')]] });
    await scrollToElement(step, ctxFor(b));
    expect(b.of('swipe')).toHaveLength(2);
    expect(b.of('swipe')[0].args).toEqual([{ direction: 'up' }]);
  });

  test('step.value picks the direction', async () => {
    const b = makeFakeBridge({ elements: [[el('a')], [el('Footer')]] });
    await scrollToElement({ ...step, value: 'down' }, ctxFor(b));
    expect(b.of('swipe')[0].args).toEqual([{ direction: 'down' }]);
  });

  test('exhausts scroll_max_swipes and fails with the count', async () => {
    const b = makeFakeBridge({ elements: [[el('a')]] });
    const err = await scrollToElement(step, ctxFor(b)).catch((e) => e);
    expect(b.of('swipe')).toHaveLength(10);
    expect(err.message).toMatch(/after 10 swipes/);
    expect(err.message).toMatch(/no element matches target "Footer"/);
  });

  test('honours the configured scroll_max_swipes', async () => {
    const b = makeFakeBridge({ elements: [[el('a')]] });
    const settings = runSettings({ run: { scroll_max_swipes: 3 } });
    const err = await scrollToElement(step, ctxFor(b, { settings })).catch((e) => e);
    expect(b.of('swipe')).toHaveLength(3);
    expect(err.message).toMatch(/after 3 swipes/);
  });

  test('a bad direction is fatal', async () => {
    const b = makeFakeBridge({ elements: [[el('a')]] });
    const err = await scrollToElement({ ...step, value: 'diagonal' }, ctxFor(b)).catch((e) => e);
    expect(err.fatal).toBe(true);
  });
});

describe('wait_for_element_gone', () => {
  const step = { id: 'g', action: 'wait_for_element_gone', target: 'Spinner' };

  test('gone at once', async () => {
    const b = makeFakeBridge({ elements: [[el('Ready')]] });
    await waitForElementGone(step, ctxFor(b));
    expect(b.of('listElements')).toHaveLength(1);
  });

  test('disappears after a poll', async () => {
    const b = makeFakeBridge({ elements: [[el('Spinner')], [el('Ready')]] });
    const clock = makeFakeClock();
    await waitForElementGone(step, ctxFor(b, { clock }));
    expect(clock.now()).toBe(1500);
  });

  test('times out naming what is still on screen', async () => {
    const b = makeFakeBridge({ elements: [[el('Spinner')]] });
    const err = await waitForElementGone({ ...step, wait_config: { timeout_ms: 1000 } }, ctxFor(b)).catch((e) => e);
    expect(err.message).toBe('timed out after 1000ms: target "Spinner" is still on screen');
  });
});

describe('wait_for_loading_complete', () => {
  const step = { id: 'w', action: 'wait_for_loading_complete', wait_config: { type: 'loading_complete', timeout_ms: 10000 } };
  const settings = runSettings({ run: { loading_indicator_labels: ['Loading', 'Please wait'] } });

  test('needs two consecutive stable polls', async () => {
    const b = makeFakeBridge({ elements: [[el('Loading')], [el('Ready')], [el('Ready')]] });
    const clock = makeFakeClock();
    await waitForLoadingComplete(step, ctxFor(b, { settings, clock }));
    expect(b.of('listElements')).toHaveLength(3);
  });

  test('an indicator reappearing resets the count', async () => {
    const b = makeFakeBridge({ elements: [[el('Ready')], [el('Please wait')], [el('Ready')], [el('Ready')]] });
    await waitForLoadingComplete(step, ctxFor(b, { settings }));
    expect(b.of('listElements')).toHaveLength(4);
  });

  test('times out while an indicator persists', async () => {
    const b = makeFakeBridge({ elements: [[el('Loading')]] });
    const err = await waitForLoadingComplete({ ...step, wait_config: { type: 'loading_complete', timeout_ms: 3000 } }, ctxFor(b, { settings })).catch((e) => e);
    expect(err.message).toMatch(/timed out after 3000ms: a loading indicator is still on screen: "Loading"/);
  });

  test('no labels configured: passes after two stable polls with a note', async () => {
    const notes = [];
    const b = makeFakeBridge({ elements: [[el('Ready')]] });
    await waitForLoadingComplete(step, ctxFor(b, { observe: (m) => notes.push(m) }));
    expect(b.of('listElements')).toHaveLength(2);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/loading_indicator_labels/);
  });
});

describe('capture_value', () => {
  const step = { id: 'c', action: 'capture_value', target: 'Total', capture_to: 'total' };

  test('stores the text in ctx.variables and the store', async () => {
    const b = makeFakeBridge({ elements: [[el('Total: 5')]] });
    const ctx = ctxFor(b, { scenario: { scenario_id: 'd', variables: { total: { type: 'string', description: 'x' } } } });
    await captureValue(step, ctx);
    expect(ctx.variables.total).toBe('Total: 5');
    expect(ctx.store.captureVariable).toHaveBeenCalledWith('total', 'Total: 5');
  });

  test('falls back to the accessibility label', async () => {
    const b = makeFakeBridge({ elements: [[el(null, { accessibility_label: 'Total label' })]] });
    const ctx = ctxFor(b, { scenario: { scenario_id: 'd', variables: { total: {} } } });
    await captureValue(step, ctx);
    expect(ctx.variables.total).toBe('Total label');
  });

  test('missing capture_to is fatal', async () => {
    const b = makeFakeBridge({ elements: [[el('Total')]] });
    const err = await captureValue({ ...step, capture_to: undefined }, ctxFor(b)).catch((e) => e);
    expect(err.fatal).toBe(true);
    expect(err.message).toBe('capture_value step has no capture_to');
  });

  test('an undeclared variable is fatal', async () => {
    const b = makeFakeBridge({ elements: [[el('Total')]] });
    const err = await captureValue(step, ctxFor(b)).catch((e) => e);
    expect(err.fatal).toBe(true);
    expect(err.message).toBe('capture_value step captures to undeclared variable "total"');
  });
});
