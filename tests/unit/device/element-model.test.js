'use strict';

const { normalize } = require('../../../src/device/element-model');

describe('element-model.normalize', () => {
  test('normalizes a bounds-based element and computes center midpoint', () => {
    const out = normalize([
      {
        text: 'Login',
        accessibility_label: 'login-button',
        bounds: [0, 0, 100, 50],
        type: 'android.widget.Button',
      },
    ]);
    expect(out).toEqual([
      {
        text: 'Login',
        accessibility_label: 'login-button',
        bounds: [0, 0, 100, 50],
        center: [50, 25],
        type: 'android.widget.Button',
      },
    ]);
  });

  test('accepts rect:{x,y,width,height} and derives bounds + center', () => {
    const out = normalize([
      { label: 'Box', rect: { x: 10, y: 20, width: 40, height: 60 }, type: 'View' },
    ]);
    expect(out[0].bounds).toEqual([10, 20, 50, 80]);
    expect(out[0].center).toEqual([30, 50]);
    // `label` is mapped onto accessibility_label
    expect(out[0].accessibility_label).toBe('Box');
  });

  test('accepts a coordinates array as bounds', () => {
    const out = normalize([{ coordinates: [5, 5, 15, 25], text: 'C' }]);
    expect(out[0].bounds).toEqual([5, 5, 15, 25]);
    expect(out[0].center).toEqual([10, 15]);
  });

  test('defaults missing text and label to null', () => {
    const out = normalize([{ bounds: [0, 0, 10, 10], type: 'View' }]);
    expect(out[0].text).toBeNull();
    expect(out[0].accessibility_label).toBeNull();
  });

  test('STRIPS resource_id and identifier (platform-agnostic invariant)', () => {
    const out = normalize([
      {
        text: 'X',
        bounds: [0, 0, 2, 2],
        resource_id: 'com.app:id/login',
        identifier: 'loginBtn',
        type: 'Button',
      },
    ]);
    const keys = Object.keys(out[0]);
    expect(keys).not.toContain('resource_id');
    expect(keys).not.toContain('identifier');
    // exact key set is the agnostic shape
    expect(keys.sort()).toEqual(
      ['accessibility_label', 'bounds', 'center', 'text', 'type'].sort()
    );
  });

  test('tolerates empty / non-array input', () => {
    expect(normalize([])).toEqual([]);
    expect(normalize(undefined)).toEqual([]);
    expect(normalize(null)).toEqual([]);
  });

  test('skips entries with no resolvable bounds', () => {
    const out = normalize([{ text: 'no-bounds' }, { bounds: [0, 0, 4, 4] }]);
    expect(out).toHaveLength(1);
    expect(out[0].bounds).toEqual([0, 0, 4, 4]);
  });
});
