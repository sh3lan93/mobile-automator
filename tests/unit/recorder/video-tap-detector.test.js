'use strict';

const path = require('path');
const fs = require('fs');
const { detectIndicatorInFrame, VideoTapDetector } = require('../../../tools/recorder/src/capture/video-tap-detector');

const FRAMES = path.resolve(__dirname, '../../fixtures/recorder/video-frames');

const PROFILES = [
  { color: 'light_blue', no: 'no-indicator.png', dot1: 'dot-at-50-30.png', dot2: 'dot-at-100-50.png' },
  { color: 'ios_simulator', no: 'ios-no-indicator.png', dot1: 'ios-dot-at-50-30.png', dot2: 'ios-dot-at-100-50.png' },
];

describe('detectIndicatorInFrame', () => {
  // Fixture frames are tiny (200x100 PNG) for fast tests.
  // Each fixture is hand-crafted with a coloured dot at a known location.
  describe.each(PROFILES)('color=$color', ({ color, no, dot1 }) => {
    test('returns null when no indicator visible', () => {
      const buf = fs.readFileSync(path.join(FRAMES, no));
      expect(detectIndicatorInFrame(buf, { color })).toBeNull();
    });

    test('returns center coordinates of the indicator dot', () => {
      const buf = fs.readFileSync(path.join(FRAMES, dot1));
      const out = detectIndicatorInFrame(buf, { color });
      expect(out).not.toBeNull();
      expect(out.x).toBeGreaterThanOrEqual(45);
      expect(out.x).toBeLessThanOrEqual(55);
      expect(out.y).toBeGreaterThanOrEqual(25);
      expect(out.y).toBeLessThanOrEqual(35);
    });
  });

  test('ios_simulator profile rejects coloured pixels via maxChannelDelta (excludes Android cyan dot)', () => {
    // Cross-profile guard: the cyan Android indicator should NOT register as an iOS gray-disk hit.
    const buf = fs.readFileSync(path.join(FRAMES, 'dot-at-50-30.png'));
    expect(detectIndicatorInFrame(buf, { color: 'ios_simulator' })).toBeNull();
  });
});

describe('VideoTapDetector.processFrames', () => {
  describe.each(PROFILES)('color=$color', ({ color, no, dot1, dot2 }) => {
    test('emits down/up around frames with/without indicator', () => {
      const out = [];
      const det = new VideoTapDetector({ emit: (e) => out.push(e), color, fps: 30 });
      const frames = [
        { t: 0, buf: fs.readFileSync(path.join(FRAMES, no)) },
        { t: 33, buf: fs.readFileSync(path.join(FRAMES, dot1)) },
        { t: 66, buf: fs.readFileSync(path.join(FRAMES, dot1)) },
        { t: 99, buf: fs.readFileSync(path.join(FRAMES, no)) },
      ];
      det.processFrames(frames);
      const kinds = out.map((e) => e.kind);
      expect(kinds).toEqual(['down', 'move', 'up']);
      expect(out[0]).toMatchObject({ x: expect.any(Number), y: expect.any(Number), t: 33 });
      expect(out[2].t).toBe(99);
    });

    test('emits move when indicator is visible across consecutive frames at different coords', () => {
      const out = [];
      const det = new VideoTapDetector({ emit: (e) => out.push(e), color, fps: 30 });
      det.processFrames([
        { t: 0, buf: fs.readFileSync(path.join(FRAMES, dot1)) },
        { t: 33, buf: fs.readFileSync(path.join(FRAMES, dot2)) },
        { t: 66, buf: fs.readFileSync(path.join(FRAMES, no)) },
      ]);
      expect(out.map((e) => e.kind)).toEqual(['down', 'move', 'up']);
      expect(out[1].x).toBeGreaterThan(out[0].x);
    });
  });
});
