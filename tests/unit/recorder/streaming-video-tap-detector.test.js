'use strict';

const path = require('path');
const fs = require('fs');
const { StreamingVideoTapDetector } = require('../../../tools/recorder/src/capture/video-tap-detector');

const FRAMES = path.resolve(__dirname, '../../fixtures/recorder/video-frames');

const PROFILES = [
  { color: 'light_blue', no: 'no-indicator.png', dot1: 'dot-at-50-30.png', dot2: 'dot-at-100-50.png' },
  { color: 'ios_simulator', no: 'ios-no-indicator.png', dot1: 'ios-dot-at-50-30.png', dot2: 'ios-dot-at-100-50.png' },
];

function loadFrame(name) {
  return fs.readFileSync(path.join(FRAMES, name));
}

describe('StreamingVideoTapDetector', () => {
  describe.each(PROFILES)('color=$color', ({ color, no, dot1, dot2 }) => {
    test('emits nothing for a no-indicator frame when inactive', () => {
      const out = [];
      const det = new StreamingVideoTapDetector({ emit: (e) => out.push(e), color });
      det.feedFrame({ t: 0, buf: loadFrame(no) });
      expect(out).toEqual([]);
    });

    test('emits down on first frame containing an indicator', () => {
      const out = [];
      const det = new StreamingVideoTapDetector({ emit: (e) => out.push(e), color });
      det.feedFrame({ t: 33, buf: loadFrame(dot1) });
      expect(out).toHaveLength(1);
      expect(out[0].kind).toBe('down');
      expect(out[0].t).toBe(33);
      expect(out[0].x).toBeGreaterThanOrEqual(45);
      expect(out[0].x).toBeLessThanOrEqual(55);
    });

    test('emits move on subsequent indicator frames while active', () => {
      const out = [];
      const det = new StreamingVideoTapDetector({ emit: (e) => out.push(e), color });
      det.feedFrame({ t: 0, buf: loadFrame(dot1) });
      det.feedFrame({ t: 33, buf: loadFrame(dot2) });
      expect(out.map((e) => e.kind)).toEqual(['down', 'move']);
      expect(out[1].x).toBeGreaterThan(out[0].x);
      expect(out[1].t).toBe(33);
    });

    test('emits up when indicator disappears while active', () => {
      const out = [];
      const det = new StreamingVideoTapDetector({ emit: (e) => out.push(e), color });
      det.feedFrame({ t: 0, buf: loadFrame(dot1) });
      det.feedFrame({ t: 33, buf: loadFrame(no) });
      expect(out.map((e) => e.kind)).toEqual(['down', 'up']);
      expect(out[1].t).toBe(33);
      // Up event carries the LAST observed indicator coords (not the no-dot frame's coords)
      expect(out[1].x).toBe(out[0].x);
      expect(out[1].y).toBe(out[0].y);
    });

    test('state persists across feedFrame calls — full down/move/up cycle one frame at a time', () => {
      const out = [];
      const det = new StreamingVideoTapDetector({ emit: (e) => out.push(e), color });
      det.feedFrame({ t: 0, buf: loadFrame(no) });
      det.feedFrame({ t: 33, buf: loadFrame(dot1) });
      det.feedFrame({ t: 66, buf: loadFrame(dot1) });
      det.feedFrame({ t: 99, buf: loadFrame(no) });
      expect(out.map((e) => e.kind)).toEqual(['down', 'move', 'up']);
      expect(out[0].t).toBe(33);
      expect(out[2].t).toBe(99);
    });
  });

  test('flush emits an up event with the last known coords when a tap is still active', () => {
    const out = [];
    const det = new StreamingVideoTapDetector({ emit: (e) => out.push(e), color: 'light_blue' });
    det.feedFrame({ t: 0, buf: loadFrame('dot-at-50-30.png') });
    det.feedFrame({ t: 33, buf: loadFrame('dot-at-100-50.png') });
    det.flush();
    expect(out.map((e) => e.kind)).toEqual(['down', 'move', 'up']);
    const lastMove = out[1];
    const synthUp = out[2];
    expect(synthUp.x).toBe(lastMove.x);
    expect(synthUp.y).toBe(lastMove.y);
    expect(synthUp.t).toBe(33);
  });

  test('flush is a no-op when no tap is active', () => {
    const out = [];
    const det = new StreamingVideoTapDetector({ emit: (e) => out.push(e), color: 'light_blue' });
    det.feedFrame({ t: 0, buf: loadFrame('no-indicator.png') });
    det.flush();
    expect(out).toEqual([]);
  });

  test('flush is a no-op after a clean down/up cycle has already emitted up', () => {
    const out = [];
    const det = new StreamingVideoTapDetector({ emit: (e) => out.push(e), color: 'light_blue' });
    det.feedFrame({ t: 0, buf: loadFrame('dot-at-50-30.png') });
    det.feedFrame({ t: 33, buf: loadFrame('no-indicator.png') });
    expect(out.map((e) => e.kind)).toEqual(['down', 'up']);
    det.flush();
    expect(out.map((e) => e.kind)).toEqual(['down', 'up']);
  });

  test('a second tap after a clean cycle emits a new down', () => {
    const out = [];
    const det = new StreamingVideoTapDetector({ emit: (e) => out.push(e), color: 'light_blue' });
    det.feedFrame({ t: 0, buf: loadFrame('dot-at-50-30.png') });
    det.feedFrame({ t: 33, buf: loadFrame('no-indicator.png') });
    det.feedFrame({ t: 66, buf: loadFrame('dot-at-100-50.png') });
    det.feedFrame({ t: 99, buf: loadFrame('no-indicator.png') });
    expect(out.map((e) => e.kind)).toEqual(['down', 'up', 'down', 'up']);
    expect(out[2].t).toBe(66);
    expect(out[3].t).toBe(99);
  });
});
