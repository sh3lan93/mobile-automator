'use strict';

const { GestureClassifier } = require('../../../tools/recorder/src/coalesce/gesture-classifier');

describe('GestureClassifier', () => {
  test('emits tap for short touch with no movement', () => {
    const out = [];
    const cls = new GestureClassifier({ emit: (g) => out.push(g) });
    cls.feed({ t: 100, kind: 'down', x: 50, y: 50 });
    cls.feed({ t: 200, kind: 'up', x: 50, y: 50 });
    cls.flush();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'tap', x: 50, y: 50 });
  });

  test('emits long_press for held touch ≥500ms', () => {
    const out = [];
    const cls = new GestureClassifier({ emit: (g) => out.push(g) });
    cls.feed({ t: 100, kind: 'down', x: 50, y: 50 });
    cls.feed({ t: 700, kind: 'up', x: 50, y: 50 });
    cls.flush();
    expect(out[0].kind).toBe('long_press');
  });

  test('emits double_tap when two taps within 300ms at same coords', () => {
    const out = [];
    const cls = new GestureClassifier({ emit: (g) => out.push(g) });
    cls.feed({ t: 100, kind: 'down', x: 50, y: 50 });
    cls.feed({ t: 180, kind: 'up', x: 50, y: 50 });
    cls.feed({ t: 350, kind: 'down', x: 52, y: 51 });
    cls.feed({ t: 420, kind: 'up', x: 52, y: 51 });
    cls.flush();
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('double_tap');
  });

  test('two taps separated by >300ms are two taps, not a double', () => {
    const out = [];
    const cls = new GestureClassifier({ emit: (g) => out.push(g) });
    cls.feed({ t: 100, kind: 'down', x: 50, y: 50 });
    cls.feed({ t: 180, kind: 'up', x: 50, y: 50 });
    cls.feed({ t: 600, kind: 'down', x: 50, y: 50 });
    cls.feed({ t: 680, kind: 'up', x: 50, y: 50 });
    cls.flush();
    expect(out.map((g) => g.kind)).toEqual(['tap', 'tap']);
  });

  test('emits swipe with direction from delta', () => {
    const out = [];
    const cls = new GestureClassifier({ emit: (g) => out.push(g) });
    cls.feed({ t: 100, kind: 'down', x: 100, y: 800 });
    cls.feed({ t: 150, kind: 'move', x: 100, y: 600 });
    cls.feed({ t: 200, kind: 'up', x: 100, y: 400 });
    cls.flush();
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('swipe');
    expect(out[0].direction).toBe('up');
    expect(out[0].from).toEqual([100, 800]);
    expect(out[0].to).toEqual([100, 400]);
  });

  test('swipe distinguishes left/right/up/down by dominant axis', () => {
    const out = [];
    const cls = new GestureClassifier({ emit: (g) => out.push(g) });
    cls.feed({ t: 0, kind: 'down', x: 800, y: 500 });
    cls.feed({ t: 100, kind: 'up', x: 100, y: 500 });
    cls.flush();
    expect(out[0].direction).toBe('left');
  });
});
