'use strict';

const {
  isInKeyboardRegion,
  keyAtCoordinate,
} = require('../../../tools/recorder/src/capture/keyboard-region');

describe('isInKeyboardRegion', () => {
  test('returns false when no keyboard in snapshot', () => {
    const snap = {
      elements: [
        { type: 'android.widget.Button', bounds: [0, 0, 1080, 200] },
      ],
    };
    expect(isInKeyboardRegion(snap, 200, 100)).toBe(false);
  });

  test('returns true when (x,y) inside an Android SoftInputWindow bounds', () => {
    const snap = {
      elements: [
        { type: 'android.inputmethodservice.SoftInputWindow', bounds: [0, 1500, 1080, 2400] },
      ],
    };
    expect(isInKeyboardRegion(snap, 540, 1800)).toBe(true);
    expect(isInKeyboardRegion(snap, 540, 200)).toBe(false);
  });

  test('returns true for iOS UIKeyboard class', () => {
    const snap = {
      elements: [
        { type: 'UIKeyboardImpl', bounds: [0, 600, 414, 896] },
      ],
    };
    expect(isInKeyboardRegion(snap, 100, 750)).toBe(true);
  });

  test('honors the `class` field (not just `type`) when matching', () => {
    const snap = {
      elements: [
        { class: 'android.inputmethodservice.SoftInputWindow', bounds: [0, 1500, 1080, 2400] },
      ],
    };
    expect(isInKeyboardRegion(snap, 540, 1800)).toBe(true);
  });
});

describe('keyAtCoordinate', () => {
  test('returns text of smallest leaf containing the point', () => {
    const snap = {
      elements: [
        { type: 'android.inputmethodservice.SoftInputWindow', bounds: [0, 1500, 1080, 2400] },
        { type: 'android.view.View', bounds: [0, 1800, 100, 1900], text: 't' },
        { type: 'android.view.View', bounds: [100, 1800, 200, 1900], text: 'e' },
      ],
    };
    expect(keyAtCoordinate(snap, 50, 1850)).toBe('t');
    expect(keyAtCoordinate(snap, 150, 1850)).toBe('e');
  });

  test('returns null when no leaf contains the point', () => {
    const snap = {
      elements: [
        { type: 'android.view.View', bounds: [0, 1800, 100, 1900], text: 't' },
      ],
    };
    expect(keyAtCoordinate(snap, 500, 500)).toBeNull();
  });

  test('falls back to accessibility_label when text is empty', () => {
    const snap = {
      elements: [
        { type: 'android.view.View', bounds: [0, 1800, 100, 1900], text: '', accessibility_label: 's' },
      ],
    };
    expect(keyAtCoordinate(snap, 50, 1850)).toBe('s');
  });

  test('falls back to content_description when text and accessibility_label are absent', () => {
    const snap = {
      elements: [
        { type: 'android.view.View', bounds: [0, 1800, 100, 1900], content_description: 'a' },
      ],
    };
    expect(keyAtCoordinate(snap, 50, 1850)).toBe('a');
  });

  test('returns null when leaf has no text/label/desc', () => {
    const snap = {
      elements: [
        { type: 'android.view.View', bounds: [0, 1800, 100, 1900] },
      ],
    };
    expect(keyAtCoordinate(snap, 50, 1850)).toBeNull();
  });

  test('picks smallest leaf when multiple contain the point', () => {
    const snap = {
      elements: [
        { type: 'android.inputmethodservice.SoftInputWindow', bounds: [0, 1500, 1080, 2400] },
        { type: 'KeyboardRow', bounds: [0, 1800, 1080, 1900] },
        { type: 'Key', bounds: [40, 1810, 110, 1890], text: 'q' },
      ],
    };
    expect(keyAtCoordinate(snap, 70, 1850)).toBe('q');
  });
});
