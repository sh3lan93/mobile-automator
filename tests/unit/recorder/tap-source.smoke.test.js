'use strict';

// Smoke test only — DO NOT require a real device.
//
// Slice 8 (best-effort): the live tap source plugs mobile-mcp screen recording
// into capture/video-tap-detector and emits {t, kind, x, y} events shaped
// exactly like mode-b's `deps.tapSource` expects. This test exercises the
// emitter interface and the frame→tap path with SYNTHETIC frames and a FAKE
// bridge — the real on-device path (screen-record start/stop + ffmpeg frame
// extraction) is the known PRD build risk and needs on-device validation.

const fs = require('fs');
const path = require('path');

const { createTapSource } = require('../../../tools/recorder/src/capture/tap-source');

const FRAMES_DIR = path.resolve(
  __dirname, '..', '..', 'fixtures', 'recorder', 'video-frames'
);

describe('tap-source (smoke)', () => {
  test('exposes the emitter interface (.on / start / stop)', () => {
    const src = createTapSource({ bridge: {} });
    expect(typeof src.on).toBe('function');
    expect(typeof src.start).toBe('function');
    expect(typeof src.stop).toBe('function');
  });

  test('emits a down→up tap sequence from synthetic frames via the detector', () => {
    // A frame with the indicator dot, then one without → down then up.
    const withDot = fs.readFileSync(path.join(FRAMES_DIR, 'dot-at-50-30.png'));
    const noDot = fs.readFileSync(path.join(FRAMES_DIR, 'no-indicator.png'));

    const src = createTapSource({ bridge: {}, color: 'light_blue' });
    const taps = [];
    src.on('tap', (ev) => taps.push(ev));

    // Drive the detector directly with synthetic frames (no device, no ffmpeg).
    src._processFrames([
      { t: 0, buf: withDot },
      { t: 33, buf: noDot },
    ]);

    const kinds = taps.map((t) => t.kind);
    expect(kinds).toContain('down');
    expect(kinds).toContain('up');
    for (const ev of taps) {
      expect(typeof ev.t).toBe('number');
      expect(typeof ev.x).toBe('number');
      expect(typeof ev.y).toBe('number');
    }
  });
});
