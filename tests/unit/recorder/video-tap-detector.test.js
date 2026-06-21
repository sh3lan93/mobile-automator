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

  test('ios_simulator profile extracts the touch centroid from a real iOS Sim background composite', () => {
    // ios-real-touch.png is a 200x100 crop of a real `xcrun simctl io booted screenshot`
    // with a calibrated mid-grey disk composited at (100, 50) — see
    // scripts/fixtures/composite-ios-touch-overlay.js. This locks in that the
    // colour band isolates the indicator's intrinsic fill from real iOS UI pixels.
    const buf = fs.readFileSync(path.join(FRAMES, 'ios-real-touch.png'));
    const out = detectIndicatorInFrame(buf, { color: 'ios_simulator' });
    expect(out).not.toBeNull();
    const dist = Math.sqrt((out.x - 100) ** 2 + (out.y - 50) ** 2);
    expect(dist).toBeLessThan(10);
  });
});

// Fixture helpers for streaming tests: reuse the same PNG files the
// processFrames suite uses, scoped to the light_blue (Android) profile.
function frameWithDot(x, y) {
  // NOTE: (x,y) args are nominal labels used to pick between the two available
  // fixture PNGs — they are NOT pixel coordinates injected into the image.
  // The underlying PNG has its indicator baked at the fixture's fixed location
  // (near (50,30) or (100,50)). Tests that call frameWithDot assert on event
  // `kind` and `t`, not on exact pixel coords.
  // dot-at-50-30.png has the indicator near (50,30); dot-at-100-50.png near (100,50).
  // We pick whichever file is closest to the requested coordinate.
  const file = (x <= 75 && y <= 40) ? 'dot-at-50-30.png' : 'dot-at-100-50.png';
  return fs.readFileSync(path.join(FRAMES, file));
}

function frameBlank() {
  return fs.readFileSync(path.join(FRAMES, 'no-indicator.png'));
}

describe('VideoTapDetector.streaming feed()', () => {
  test('emits down on first dot frame, up after dot disappears', () => {
    const events = [];
    const det = new VideoTapDetector({ emit: (e) => events.push(e), color: 'light_blue' });
    det.feed({ t: 0, buf: frameWithDot(100, 200) });
    det.feed({ t: 30, buf: frameWithDot(100, 200) });
    det.feed({ t: 60, buf: frameBlank() });
    expect(events.map((e) => e.kind)).toEqual(['down', 'move', 'up']);
  });

  test('flush() emits a trailing up if a touch is still active', () => {
    const events = [];
    const det = new VideoTapDetector({ emit: (e) => events.push(e), color: 'light_blue' });
    det.feed({ t: 0, buf: frameWithDot(10, 10) });
    det.flush();
    expect(events.map((e) => e.kind)).toEqual(['down', 'up']);
  });

  test('processFrames() does not corrupt _lastT; flush() still carries the streaming timestamp', () => {
    // Scenario: a streaming touch starts at t=100 via feed(), then processFrames()
    // is called on a separate batch whose last frame is at t=999.  After the
    // batch, flush() must emit the trailing `up` at t=100 (the streaming _lastT)
    // — NOT t=999 (the batch's last frame timestamp).  This directly exercises
    // the _lastT save/restore added to processFrames().
    const events = [];
    const det = new VideoTapDetector({ emit: (e) => events.push(e), color: 'light_blue' });

    // 1. Start a streaming touch — _lastT becomes 100.
    det.feed({ t: 100, buf: frameWithDot(10, 10) });
    expect(events.map((e) => e.kind)).toEqual(['down']);

    // 2. Run a self-contained batch that ends at t=999.
    //    processFrames() must not clobber _lastT=100.
    det.processFrames([
      { t: 500, buf: frameWithDot(100, 100) },
      { t: 999, buf: frameBlank() },
    ]);

    // 3. Flush the still-active streaming touch.
    det.flush();

    const upEvents = events.filter((e) => e.kind === 'up');
    // The batch emits its own up at t=999 (inside processFrames).
    // The streaming flush must emit an up at t=100 — NOT t=999.
    const streamingUp = upEvents[upEvents.length - 1];
    expect(streamingUp.t).toBe(100);
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
