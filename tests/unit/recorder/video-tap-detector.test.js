'use strict';

const path = require('path');
const fs = require('fs');
const { detectIndicatorInFrame, VideoTapDetector } = require('../../../tools/recorder/src/capture/video-tap-detector');

const FRAMES = path.resolve(__dirname, '../../fixtures/recorder/video-frames');

describe('detectIndicatorInFrame', () => {
  // Note: fixture frames are tiny (200x100 PNG) for fast tests.
  // Each fixture is hand-crafted with a colored dot at a known location.
  test('returns null when no indicator visible', () => {
    const buf = fs.readFileSync(path.join(FRAMES, 'no-indicator.png'));
    expect(detectIndicatorInFrame(buf, { color: 'light_blue' })).toBeNull();
  });

  test('returns center coordinates of the indicator dot', () => {
    const buf = fs.readFileSync(path.join(FRAMES, 'dot-at-50-30.png'));
    const out = detectIndicatorInFrame(buf, { color: 'light_blue' });
    expect(out).not.toBeNull();
    expect(out.x).toBeGreaterThanOrEqual(45);
    expect(out.x).toBeLessThanOrEqual(55);
    expect(out.y).toBeGreaterThanOrEqual(25);
    expect(out.y).toBeLessThanOrEqual(35);
  });
});

describe('VideoTapDetector.processFrames', () => {
  test('emits down/up around frames with/without indicator', async () => {
    const out = [];
    const det = new VideoTapDetector({ emit: (e) => out.push(e), color: 'light_blue', fps: 30 });
    const frames = [
      { t: 0, buf: fs.readFileSync(path.join(FRAMES, 'no-indicator.png')) },
      { t: 33, buf: fs.readFileSync(path.join(FRAMES, 'dot-at-50-30.png')) },
      { t: 66, buf: fs.readFileSync(path.join(FRAMES, 'dot-at-50-30.png')) },
      { t: 99, buf: fs.readFileSync(path.join(FRAMES, 'no-indicator.png')) },
    ];
    det.processFrames(frames);
    const kinds = out.map((e) => e.kind);
    expect(kinds).toEqual(['down', 'move', 'up']);
    expect(out[0]).toMatchObject({ x: expect.any(Number), y: expect.any(Number), t: 33 });
    expect(out[2].t).toBe(99);
  });

  test('emits move when indicator is visible across consecutive frames at different coords', async () => {
    // Synthesize a moving-dot path in two different frame fixtures.
    const out = [];
    const det = new VideoTapDetector({ emit: (e) => out.push(e), color: 'light_blue', fps: 30 });
    det.processFrames([
      { t: 0, buf: fs.readFileSync(path.join(FRAMES, 'dot-at-50-30.png')) },
      { t: 33, buf: fs.readFileSync(path.join(FRAMES, 'dot-at-100-50.png')) },
      { t: 66, buf: fs.readFileSync(path.join(FRAMES, 'no-indicator.png')) },
    ]);
    expect(out.map((e) => e.kind)).toEqual(['down', 'move', 'up']);
    expect(out[1].x).toBeGreaterThan(out[0].x);
  });
});
