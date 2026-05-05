'use strict';

const { resolveElement } = require('../../../tools/recorder/src/capture/element-resolver');

const SAMPLE_SNAPSHOT = {
  elements: [
    { type: 'android.widget.LinearLayout', bounds: [0, 0, 1080, 2400] },
    { type: 'android.widget.Button', bounds: [320, 1050, 760, 1130], text: 'Login', resource_id: 'com.example:id/btn_login' },
    { type: 'android.widget.TextView', bounds: [100, 200, 980, 240], text: 'Welcome' },
    { type: 'android.widget.Button', bounds: [320, 1200, 760, 1280], accessibility_label: 'Sign Up button' },
    { type: 'android.widget.View', bounds: [0, 2300, 1080, 2400] },
  ],
};

describe('resolveElement', () => {
  test('selects the smallest leaf containing the point', () => {
    const out = resolveElement(SAMPLE_SNAPSHOT, 540, 1090);
    expect(out.display_name).toBe('Login');
    expect(out.raw_element.resource_id).toBe('com.example:id/btn_login');
  });

  test('prefers accessibility_label over text', () => {
    const out = resolveElement(SAMPLE_SNAPSHOT, 540, 1240);
    expect(out.display_name).toBe('Sign Up button');
  });

  test('falls back to resource_id last segment when no text/label', () => {
    const snap = { elements: [{ type: 'Button', bounds: [0, 0, 100, 100], resource_id: 'com.example:id/fab_add_notes' }] };
    const out = resolveElement(snap, 50, 50);
    expect(out.display_name).toBe('fab_add_notes');
  });

  test('falls back to unnamed_<class> when nothing else available', () => {
    const snap = { elements: [{ type: 'androidx.compose.ui.platform.ComposeView', bounds: [0, 0, 100, 100] }] };
    const out = resolveElement(snap, 50, 50);
    expect(out.display_name).toMatch(/^unnamed_/);
    expect(out.is_unnamed).toBe(true);
  });

  test('returns null when no element contains the point', () => {
    const snap = { elements: [{ type: 'Button', bounds: [0, 0, 100, 100], text: 'A' }] };
    expect(resolveElement(snap, 200, 200)).toBeNull();
  });

  test('handles iOS-style isAccessibilityElement label', () => {
    const snap = { elements: [{ type: 'XCUIElementTypeButton', bounds: [10, 10, 200, 80], accessibility_label: 'Back' }] };
    const out = resolveElement(snap, 100, 40);
    expect(out.display_name).toBe('Back');
  });
});
