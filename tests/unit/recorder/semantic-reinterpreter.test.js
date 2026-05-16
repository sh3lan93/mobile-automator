'use strict';

const { reinterpret } = require('../../../tools/recorder/src/coalesce/semantic-reinterpreter');

const ANDROID_PERM_SNAP = {
  elements: [
    { type: 'android.widget.Button', bounds: [60, 1400, 320, 1480], text: "Don't allow",
      resource_id: 'com.android.permissioncontroller:id/permission_deny_button' },
    { type: 'android.widget.Button', bounds: [340, 1400, 600, 1480], text: 'Allow',
      resource_id: 'com.android.permissioncontroller:id/permission_allow_button' },
  ],
};

const IOS_PERM_SNAP = {
  elements: [
    { type: '_UIAlertController', bounds: [0, 0, 390, 844] },
    { type: 'XCUIElementTypeButton', bounds: [40, 500, 350, 560], accessibility_label: 'Allow' },
    { type: 'XCUIElementTypeButton', bounds: [40, 570, 350, 630], accessibility_label: "Don't Allow" },
  ],
};

describe('reinterpret (agnostic mode)', () => {
  const M = 'platform-agnostic';

  test('Android BACK press_button -> press_back', () => {
    const out = reinterpret({ kind: 'press_button', value: 'BACK', t: 10 }, null, M);
    expect(out.kind).toBe('press_back');
    expect(out.derived_from).toMatchObject({ kind: 'press_button', value: 'BACK' });
  });

  test('non-BACK press_button is unchanged', () => {
    const out = reinterpret({ kind: 'press_button', value: 'HOME', t: 10 }, null, M);
    expect(out.kind).toBe('press_button');
    expect(out.derived_from).toBeUndefined();
  });

  test('iOS edge-swipe-right -> press_back', () => {
    const out = reinterpret({ kind: 'swipe', from: [8, 400], to: [300, 400], direction: 'right', t: 20 }, null, M);
    expect(out.kind).toBe('press_back');
    expect(out.derived_from).toMatchObject({ kind: 'swipe', direction: 'right' });
  });

  test('non-edge right swipe is unchanged', () => {
    const out = reinterpret({ kind: 'swipe', from: [200, 400], to: [360, 400], direction: 'right', t: 20 }, null, M);
    expect(out.kind).toBe('swipe');
  });

  test('Android permission Allow tap -> grant_permission', () => {
    const out = reinterpret({ kind: 'tap', target: 'Allow', x: 470, y: 1440, t: 30 }, ANDROID_PERM_SNAP, M);
    expect(out.kind).toBe('grant_permission');
  });

  test("Android permission Don't allow tap -> deny_permission", () => {
    const out = reinterpret({ kind: 'tap', target: "Don't allow", x: 190, y: 1440, t: 31 }, ANDROID_PERM_SNAP, M);
    expect(out.kind).toBe('deny_permission');
  });

  test('iOS _UIAlertController Allow tap -> grant_permission', () => {
    const out = reinterpret({ kind: 'tap', target: 'Allow', x: 200, y: 530, t: 32 }, IOS_PERM_SNAP, M);
    expect(out.kind).toBe('grant_permission');
  });

  test('regular tap (no permission dialog in snapshot) is unchanged', () => {
    const snap = { elements: [{ type: 'android.widget.Button', bounds: [0, 0, 100, 100], text: 'Allow' }] };
    const out = reinterpret({ kind: 'tap', target: 'Allow', x: 50, y: 50, t: 33 }, snap, M);
    expect(out.kind).toBe('tap');
  });

  test('missing snapshot never throws for a tap', () => {
    expect(() => reinterpret({ kind: 'tap', target: 'Allow', t: 1 }, null, M)).not.toThrow();
  });
});

describe('reinterpret (aware mode = identity)', () => {
  const M = 'platform-aware';
  test('BACK stays press_button', () => {
    expect(reinterpret({ kind: 'press_button', value: 'BACK', t: 1 }, null, M).kind).toBe('press_button');
  });
  test('edge-swipe stays swipe', () => {
    expect(reinterpret({ kind: 'swipe', from: [2, 9], direction: 'right', t: 1 }, null, M).kind).toBe('swipe');
  });
  test('permission tap stays tap', () => {
    expect(reinterpret({ kind: 'tap', target: 'Allow', t: 1 }, ANDROID_PERM_SNAP, M).kind).toBe('tap');
  });
});
