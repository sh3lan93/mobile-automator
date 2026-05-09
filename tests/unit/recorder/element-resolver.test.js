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

  test('iOS XCUIElementTypeTextField resolves via accessibility_label', () => {
    const snap = {
      elements: [
        {
          type: 'XCUIElementTypeTextField',
          bounds: [40, 200, 360, 260],
          accessibility_label: 'Email',
        },
      ],
    };
    const out = resolveElement(snap, 200, 230);
    expect(out.display_name).toBe('Email');
    expect(out.is_unnamed).toBe(false);
  });

  test('iOS XCUIElementTypeSecureTextField with accessibility_traits is named via label and surfaces traits on raw_element', () => {
    const snap = {
      elements: [
        {
          type: 'XCUIElementTypeSecureTextField',
          bounds: [40, 280, 360, 340],
          accessibility_label: 'Password',
          accessibility_traits: ['secureTextField'],
        },
      ],
    };
    const out = resolveElement(snap, 200, 310);
    expect(out.display_name).toBe('Password');
    expect(out.is_unnamed).toBe(false);
    expect(out.raw_element.accessibility_traits).toEqual(['secureTextField']);
  });

  test('unnamed iOS view falls back to short class without XCUIElementType prefix', () => {
    const snap = { elements: [{ type: 'XCUIElementTypeView', bounds: [0, 0, 100, 100] }] };
    const out = resolveElement(snap, 50, 50);
    expect(out.display_name).toBe('unnamed_view');
    expect(out.is_unnamed).toBe(true);
  });

  test('iOS nav-bar back button resolves to literal "Back" — no special-case logic', () => {
    // Locks in that aware-mode iOS back navigation produces a regular tap step, not press_back.
    const snap = {
      elements: [
        {
          type: 'XCUIElementTypeButton',
          bounds: [10, 30, 80, 90],
          accessibility_label: 'Back',
        },
      ],
    };
    const out = resolveElement(snap, 40, 40);
    expect(out.display_name).toBe('Back');
    expect(out.is_unnamed).toBe(false);
  });
});
