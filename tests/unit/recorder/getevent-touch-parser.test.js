'use strict';

const { GeteventTouchParser } = require('../../../tools/recorder/src/capture/getevent-touch-parser');

function collect(lines, opts = {}) {
  const events = [];
  const p = new GeteventTouchParser({ emit: (e) => events.push(e), scaleX: 1, scaleY: 1, tStart: null, ...opts });
  p.feedChunk(lines.join('\n') + '\n');
  p.end();
  return events;
}

describe('GeteventTouchParser', () => {
  test('emits down then up for a single tap frame sequence', () => {
    const events = collect([
      '[   100.000000] /dev/input/event3: EV_ABS       ABS_MT_POSITION_X    00000064',
      '[   100.000000] /dev/input/event3: EV_ABS       ABS_MT_POSITION_Y    000000c8',
      '[   100.000000] /dev/input/event3: EV_KEY       BTN_TOUCH            DOWN',
      '[   100.000000] /dev/input/event3: EV_SYN       SYN_REPORT           00000000',
      '[   100.080000] /dev/input/event3: EV_KEY       BTN_TOUCH            UP',
      '[   100.080000] /dev/input/event3: EV_SYN       SYN_REPORT           00000000',
    ]);
    expect(events).toEqual([
      { kind: 'down', t: 0, x: 100, y: 200 },
      { kind: 'up', t: 80, x: 100, y: 200 },
    ]);
  });

  test('emits move frames while touch is held and position changes', () => {
    const events = collect([
      '[   200.000000] /dev/input/event3: EV_ABS       ABS_MT_POSITION_X    0000000a',
      '[   200.000000] /dev/input/event3: EV_ABS       ABS_MT_POSITION_Y    0000000a',
      '[   200.000000] /dev/input/event3: EV_KEY       BTN_TOUCH            DOWN',
      '[   200.000000] /dev/input/event3: EV_SYN       SYN_REPORT           00000000',
      '[   200.050000] /dev/input/event3: EV_ABS       ABS_MT_POSITION_X    00000014',
      '[   200.050000] /dev/input/event3: EV_SYN       SYN_REPORT           00000000',
      '[   200.100000] /dev/input/event3: EV_KEY       BTN_TOUCH            UP',
      '[   200.100000] /dev/input/event3: EV_SYN       SYN_REPORT           00000000',
    ]);
    expect(events.map((e) => e.kind)).toEqual(['down', 'move', 'up']);
    expect(events[1]).toEqual({ kind: 'move', t: 50, x: 20, y: 10 });
  });

  test('applies scale factors to raw coordinates', () => {
    const events = collect([
      '[   300.000000] /dev/input/event3: EV_ABS       ABS_MT_POSITION_X    00000064',
      '[   300.000000] /dev/input/event3: EV_ABS       ABS_MT_POSITION_Y    00000064',
      '[   300.000000] /dev/input/event3: EV_KEY       BTN_TOUCH            DOWN',
      '[   300.000000] /dev/input/event3: EV_SYN       SYN_REPORT           00000000',
      '[   300.010000] /dev/input/event3: EV_KEY       BTN_TOUCH            UP',
      '[   300.010000] /dev/input/event3: EV_SYN       SYN_REPORT           00000000',
    ], { scaleX: 2, scaleY: 3 });
    expect(events[0]).toEqual({ kind: 'down', t: 0, x: 200, y: 300 });
  });

  test('honors a literal tStart of 100 (not swallowed by falsy check)', () => {
    // tStart:100 means timestamps are relative to t=100s; events at 100.000 → t=0, 100.080 → t=80
    const events = collect([
      '[   100.000000] /dev/input/event3: EV_ABS       ABS_MT_POSITION_X    00000064',
      '[   100.000000] /dev/input/event3: EV_ABS       ABS_MT_POSITION_Y    000000c8',
      '[   100.000000] /dev/input/event3: EV_KEY       BTN_TOUCH            DOWN',
      '[   100.000000] /dev/input/event3: EV_SYN       SYN_REPORT           00000000',
      '[   100.080000] /dev/input/event3: EV_KEY       BTN_TOUCH            UP',
      '[   100.080000] /dev/input/event3: EV_SYN       SYN_REPORT           00000000',
    ], { tStart: 100 });
    expect(events).toEqual([
      { kind: 'down', t: 0, x: 100, y: 200 },
      { kind: 'up', t: 80, x: 100, y: 200 },
    ]);
  });

  test('emits hardware key events', () => {
    const events = collect([
      '[   400.000000] /dev/input/event1: EV_KEY       KEY_BACK             DOWN',
      '[   400.000000] /dev/input/event1: EV_KEY       KEY_BACK             UP',
    ]);
    expect(events).toEqual([
      { kind: 'key', t: 0, key: 'BACK', state: 'down' },
      { kind: 'key', t: 0, key: 'BACK', state: 'up' },
    ]);
  });
});
