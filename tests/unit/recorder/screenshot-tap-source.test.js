'use strict';

const { createScreenshotTapSource } = require('../../../tools/recorder/src/capture/screenshot-tap-source');

describe('createScreenshotTapSource', () => {
  test('feeds polled frames to the detector and emits taps', async () => {
    // Drive the poll loop manually via a fake timer.
    let tick = null;
    const fakeSetInterval = (fn) => { tick = fn; return 1; };
    const fakeClearInterval = jest.fn();

    // captureFrame returns a sequence: dot, dot, blank → down, move, up.
    const frames = [{ buf: Buffer.from('DOT') }, { buf: Buffer.from('DOT') }, { buf: Buffer.from('BLANK') }];
    let i = 0;
    const captureFrame = jest.fn(async () => frames[i++] || { buf: Buffer.from('BLANK') });

    // Inject a fake detector via the `makeDetector` seam so we don't decode PNGs here.
    const emitted = [];
    const fakeDetector = {
      feed: (f) => { if (String(f.buf) === 'DOT' && !fakeDetector._a) { fakeDetector._a = true; emitted.push('down'); }
                     else if (String(f.buf) === 'DOT') { emitted.push('move'); }
                     else if (fakeDetector._a) { fakeDetector._a = false; emitted.push('up'); } },
      flush: () => {},
    };

    const src = createScreenshotTapSource({
      deviceLabel: 'UDID', intervalMs: 125, captureFrame,
      setInterval: fakeSetInterval, clearInterval: fakeClearInterval,
      makeDetector: () => fakeDetector,
    });
    await src.start();
    await tick(); await tick(); await tick();   // three polls
    await src.stop();

    expect(emitted).toEqual(['down', 'move', 'up']);
    expect(fakeClearInterval).toHaveBeenCalled();
  });

  test('stop() before start() is a safe no-op', async () => {
    const fakeClearInterval = jest.fn();
    const captureFrame = jest.fn(async () => ({ buf: Buffer.from('X') }));
    const fakeDetector = { feed: jest.fn(), flush: jest.fn() };

    const src = createScreenshotTapSource({
      deviceLabel: 'UDID', intervalMs: 125, captureFrame,
      setInterval: () => 1, clearInterval: fakeClearInterval,
      makeDetector: () => fakeDetector,
    });

    // stop() without start() must not throw and must not call clearInterval
    await expect(src.stop()).resolves.toBeUndefined();
    expect(fakeClearInterval).not.toHaveBeenCalled();
  });

  test('double start() registers only one interval', async () => {
    const fakeSetInterval = jest.fn(() => 1);
    const captureFrame = jest.fn(async () => ({ buf: Buffer.from('X') }));
    const fakeDetector = { feed: jest.fn(), flush: jest.fn() };

    const src = createScreenshotTapSource({
      deviceLabel: 'UDID', intervalMs: 125, captureFrame,
      setInterval: fakeSetInterval, clearInterval: jest.fn(),
      makeDetector: () => fakeDetector,
    });

    await src.start();
    await src.start();  // second call must be a no-op

    expect(fakeSetInterval).toHaveBeenCalledTimes(1);
  });
});
