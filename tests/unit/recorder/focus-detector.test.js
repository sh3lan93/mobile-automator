'use strict';

const { findFocusedField } = require('../../../tools/recorder/src/capture/focus-detector');

describe('findFocusedField', () => {
  test('returns null when no element is focused', () => {
    const snap = {
      elements: [
        { type: 'android.widget.EditText', bounds: [0, 0, 100, 100], id: 'a', text: '' },
        { type: 'android.widget.Button', bounds: [0, 100, 100, 200], focused: false },
      ],
    };
    expect(findFocusedField(snap)).toBeNull();
  });

  test('returns id, label, sensitive=false for a focused EditText', () => {
    const snap = {
      elements: [
        {
          type: 'android.widget.EditText',
          bounds: [100, 500, 980, 580],
          id: 'email_input',
          accessibility_label: 'Email',
          focused: true,
        },
      ],
    };
    const out = findFocusedField(snap);
    expect(out).toEqual({ id: 'email_input', label: 'Email', sensitive: false });
  });

  test('returns sensitive=true for a focused UISecureTextField', () => {
    const snap = {
      elements: [
        {
          type: 'UISecureTextField',
          bounds: [100, 500, 980, 580],
          id: 'pwd_field',
          accessibility_label: 'Password',
          focused: true,
        },
      ],
    };
    expect(findFocusedField(snap)).toEqual({
      id: 'pwd_field',
      label: 'Password',
      sensitive: true,
    });
  });

  test('returns sensitive=true for focused EditText with inputType=textPassword', () => {
    const snap = {
      elements: [
        {
          type: 'android.widget.EditText',
          bounds: [100, 500, 980, 580],
          id: 'pwd_input',
          accessibility_label: 'Password',
          inputType: 'textPassword',
          focused: true,
        },
      ],
    };
    expect(findFocusedField(snap)).toEqual({
      id: 'pwd_input',
      label: 'Password',
      sensitive: true,
    });
  });

  test('returns sensitive=false for focused XCUIElementTypeTextField (non-secure)', () => {
    const snap = {
      elements: [
        {
          type: 'XCUIElementTypeTextField',
          bounds: [10, 10, 200, 80],
          id: 'name_field',
          accessibility_label: 'Name',
          focused: true,
        },
      ],
    };
    expect(findFocusedField(snap)).toEqual({
      id: 'name_field',
      label: 'Name',
      sensitive: false,
    });
  });

  test('ignores non-input classes that have focused: true', () => {
    const snap = {
      elements: [
        { type: 'android.widget.Button', bounds: [0, 0, 100, 100], focused: true, id: 'b' },
      ],
    };
    expect(findFocusedField(snap)).toBeNull();
  });
});
