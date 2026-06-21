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
});
