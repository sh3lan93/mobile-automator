'use strict';

const {
  AndroidResolver,
  IOSResolver,
  SemanticResolutionError,
} = require('../../../../src/device/semantic-press/resolver');

function fakeBridge(overrides = {}) {
  const calls = [];
  const bridge = {
    calls,
    pressButton: async (b) => { calls.push(['pressButton', b]); },
    tap: async (xy) => { calls.push(['tap', xy]); },
    swipe: async (a) => { calls.push(['swipe', a]); },
    listElements: async () => overrides.elements || [],
    getScreenSize: async () => overrides.size || { width: 1080, height: 1920 },
  };
  return bridge;
}

describe('AndroidResolver', () => {
  test('press_back presses the BACK button', async () => {
    const b = fakeBridge();
    const r = await new AndroidResolver(b).pressBack();
    expect(r).toEqual({ mechanism: 'button:BACK' });
    expect(b.calls).toEqual([['pressButton', 'BACK']]);
  });

  test('dismiss_keyboard presses BACK', async () => {
    const b = fakeBridge();
    const r = await new AndroidResolver(b).dismissKeyboard();
    expect(r).toEqual({ mechanism: 'button:BACK' });
    expect(b.calls).toEqual([['pressButton', 'BACK']]);
  });

  test('grant_permission taps the Allow affordance center', async () => {
    const b = fakeBridge({ elements: [{ text: 'Allow', center: [500, 1500] }] });
    const r = await new AndroidResolver(b).grantPermission();
    expect(r).toEqual({ mechanism: 'tap:Allow' });
    expect(b.calls).toEqual([['tap', { x: 500, y: 1500 }]]);
  });

  test('deny_permission hard-fails when no deny affordance is present', async () => {
    const b = fakeBridge({ elements: [{ text: 'Allow', center: [1, 2] }] });
    await expect(new AndroidResolver(b).denyPermission()).rejects.toThrow(SemanticResolutionError);
  });
});

describe('IOSResolver', () => {
  test('press_back edge-swipes right from the left edge at mid-height', async () => {
    const b = fakeBridge({ size: { width: 1000, height: 2000 } });
    const r = await new IOSResolver(b).pressBack();
    expect(r).toEqual({ mechanism: 'edge_swipe' });
    expect(b.calls).toEqual([['swipe', { direction: 'right', x: 1, y: 1000, distance: 600 }]]);
  });

  test('press_back hard-fails (no swipe) when the screen size is unreadable', async () => {
    const b = fakeBridge({ size: { width: NaN, height: NaN } });
    await expect(new IOSResolver(b).pressBack()).rejects.toThrow(SemanticResolutionError);
    expect(b.calls).toEqual([]); // never emit a degenerate no-op swipe
  });

  test('dismiss_keyboard taps a return key when present', async () => {
    const b = fakeBridge({ elements: [{ text: 'Done', center: [900, 1200] }] });
    const r = await new IOSResolver(b).dismissKeyboard();
    expect(r).toEqual({ mechanism: 'tap:Done' });
    expect(b.calls).toEqual([['tap', { x: 900, y: 1200 }]]);
  });

  test('dismiss_keyboard falls back to a downward swipe when no return key', async () => {
    const b = fakeBridge({ elements: [] });
    const r = await new IOSResolver(b).dismissKeyboard();
    expect(r).toEqual({ mechanism: 'swipe:down' });
    expect(b.calls).toEqual([['swipe', { direction: 'down' }]]);
  });

  // Through a real DeviceBridge (fake engine `call`): the resolver still asks
  // for a plain direction-only swipe, and the bridge turns it into explicit
  // centred geometry rather than the engine's 400px default (#199).
  describe('through a real DeviceBridge', () => {
    const { DeviceBridge } = require('../../../../src/device/bridge');

    function engine() {
      const calls = [];
      const call = async (tool, args) => {
        calls.push([tool, args]);
        if (tool === 'mobile_get_screen_size') return 'Screen size is 1179x2556 pixels';
        if (tool === 'mobile_list_elements_on_screen') return [];
        return {};
      };
      return { calls, bridge: new DeviceBridge({ call }) };
    }

    test('dismiss_keyboard fallback swipe carries explicit centred geometry', async () => {
      const { calls, bridge } = engine();
      const r = await new IOSResolver(bridge).dismissKeyboard();
      expect(r).toEqual({ mechanism: 'swipe:down' });
      expect(calls.filter(([t]) => t === 'mobile_swipe_on_screen')).toEqual([
        ['mobile_swipe_on_screen', { direction: 'down', x: 589, y: 511, distance: 1533 }],
      ]);
    });

    test('press_back edge-swipe is forwarded byte-for-byte, one screen-size read', async () => {
      const { calls, bridge } = engine();
      await new IOSResolver(bridge).pressBack();
      expect(calls).toEqual([
        ['mobile_get_screen_size', {}],
        ['mobile_swipe_on_screen', { direction: 'right', x: 1, y: 1278, distance: 707 }],
      ]);
    });
  });

  test('grant_permission accepts an iOS-specific label', async () => {
    const b = fakeBridge({ elements: [{ accessibility_label: 'Allow While Using App', center: [400, 1600] }] });
    const r = await new IOSResolver(b).grantPermission();
    expect(r).toEqual({ mechanism: 'tap:Allow While Using App' });
    expect(b.calls).toEqual([['tap', { x: 400, y: 1600 }]]);
  });
});
