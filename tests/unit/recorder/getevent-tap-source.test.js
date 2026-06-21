'use strict';

const { EventEmitter } = require('events');
const { createGeteventTapSource } = require('../../../tools/recorder/src/capture/getevent-tap-source');

function fakeSpawn() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stdout.setEncoding = () => {};
  proc.kill = jest.fn();
  return proc;
}

describe('createGeteventTapSource', () => {
  test('spawns getevent and re-emits parsed taps as tap events', async () => {
    const proc = fakeSpawn();
    const spawn = jest.fn(() => proc);
    const computeScale = jest.fn(async () => ({ scaleX: 1, scaleY: 1 }));
    const src = createGeteventTapSource({ deviceLabel: 'emulator-5554', spawn, computeScale });

    const taps = [];
    src.on('tap', (e) => taps.push(e));
    await src.start();

    expect(spawn).toHaveBeenCalledWith('adb', expect.arrayContaining(['shell', 'getevent', '-lt']), expect.anything());
    proc.stdout.emit('data',
      '[   1.000000] /dev/input/event3: EV_ABS       ABS_MT_POSITION_X    00000064\n' +
      '[   1.000000] /dev/input/event3: EV_ABS       ABS_MT_POSITION_Y    000000c8\n' +
      '[   1.000000] /dev/input/event3: EV_KEY       BTN_TOUCH            DOWN\n' +
      '[   1.000000] /dev/input/event3: EV_SYN       SYN_REPORT           00000000\n' +
      '[   1.080000] /dev/input/event3: EV_KEY       BTN_TOUCH            UP\n' +
      '[   1.080000] /dev/input/event3: EV_SYN       SYN_REPORT           00000000\n');

    expect(taps.map((t) => t.kind)).toEqual(['down', 'up']);
    expect(taps[0]).toMatchObject({ kind: 'down', x: 100, y: 200 });
  });

  test('stop() kills the process', async () => {
    const proc = fakeSpawn();
    const src = createGeteventTapSource({
      deviceLabel: 'd', spawn: () => proc, computeScale: async () => ({ scaleX: 1, scaleY: 1 }),
    });
    await src.start();
    await src.stop();
    expect(proc.kill).toHaveBeenCalled();
  });

  test('injected now() stamps emitted tap events (shared-clock fix #107)', async () => {
    // The fake now() returns an incrementing wall-clock value starting at
    // 1_000_000 so any tap t value is clearly NOT the parser's 0-based relative t.
    let clockMs = 1_000_000;
    const now = jest.fn(() => clockMs++);

    const proc = fakeSpawn();
    const spawn = jest.fn(() => proc);
    const computeScale = jest.fn(async () => ({ scaleX: 1, scaleY: 1 }));
    const src = createGeteventTapSource({ deviceLabel: 'emulator-5554', spawn, computeScale, now });

    const taps = [];
    src.on('tap', (e) => taps.push(e));
    await src.start();

    // Feed a down + up pair.
    proc.stdout.emit('data',
      '[   1.000000] /dev/input/event3: EV_ABS       ABS_MT_POSITION_X    00000064\n' +
      '[   1.000000] /dev/input/event3: EV_ABS       ABS_MT_POSITION_Y    000000c8\n' +
      '[   1.000000] /dev/input/event3: EV_KEY       BTN_TOUCH            DOWN\n' +
      '[   1.000000] /dev/input/event3: EV_SYN       SYN_REPORT           00000000\n' +
      '[   1.080000] /dev/input/event3: EV_KEY       BTN_TOUCH            UP\n' +
      '[   1.080000] /dev/input/event3: EV_SYN       SYN_REPORT           00000000\n');

    expect(taps).toHaveLength(2);
    // Both emitted t values must come from now() (>= 1_000_000), NOT from the
    // parser's 0-based relative timestamps (which would be 0 and 80).
    expect(taps[0].t).toBeGreaterThanOrEqual(1_000_000);
    expect(taps[1].t).toBeGreaterThanOrEqual(1_000_000);
    // now() must have been called at least once per event.
    expect(now).toHaveBeenCalled();
  });
});
