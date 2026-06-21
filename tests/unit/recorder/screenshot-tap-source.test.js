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
});
