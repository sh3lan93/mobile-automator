'use strict';

const path = require('path');
const fs = require('fs');
const { PngFramer } = require('../../../tools/recorder/src/capture/png-framer');
const { detectIndicatorInFrame } = require('../../../tools/recorder/src/capture/video-tap-detector');

const FRAMES = path.resolve(__dirname, '../../fixtures/recorder/video-frames');
const PNG_A = fs.readFileSync(path.join(FRAMES, 'dot-at-50-30.png'));
const PNG_B = fs.readFileSync(path.join(FRAMES, 'dot-at-100-50.png'));

describe('PngFramer', () => {
  test('emits nothing for an empty stream', () => {
    const frames = [];
    const framer = new PngFramer({ onFrame: (f) => frames.push(f) });
    expect(frames).toEqual([]);
  });

  test('emits one frame when a complete PNG is fed in a single chunk', () => {
    const frames = [];
    const framer = new PngFramer({ onFrame: (f) => frames.push(f) });
    framer.feed(PNG_A);
    expect(frames).toHaveLength(1);
    expect(frames[0].equals(PNG_A)).toBe(true);
  });

  test('emits two frames when two concatenated PNGs are fed in one chunk', () => {
    const frames = [];
    const framer = new PngFramer({ onFrame: (f) => frames.push(f) });
    framer.feed(Buffer.concat([PNG_A, PNG_B]));
    expect(frames).toHaveLength(2);
    expect(frames[0].equals(PNG_A)).toBe(true);
    expect(frames[1].equals(PNG_B)).toBe(true);
  });

  test('holds a partial PNG until completion across two chunks', () => {
    const frames = [];
    const framer = new PngFramer({ onFrame: (f) => frames.push(f) });
    const split = Math.floor(PNG_A.length / 2);
    framer.feed(PNG_A.slice(0, split));
    expect(frames).toEqual([]);
    framer.feed(PNG_A.slice(split));
    expect(frames).toHaveLength(1);
    expect(frames[0].equals(PNG_A)).toBe(true);
  });

  test('reassembles two concatenated PNGs split across many tiny chunks', () => {
    const frames = [];
    const framer = new PngFramer({ onFrame: (f) => frames.push(f) });
    const stream = Buffer.concat([PNG_A, PNG_B]);
    const chunkSize = 4;
    for (let i = 0; i < stream.length; i += chunkSize) {
      framer.feed(stream.slice(i, i + chunkSize));
    }
    expect(frames).toHaveLength(2);
    expect(frames[0].equals(PNG_A)).toBe(true);
    expect(frames[1].equals(PNG_B)).toBe(true);
  });

  test('the emitted frame buffer is a valid standalone PNG (round-trips through detectIndicatorInFrame)', () => {
    const frames = [];
    const framer = new PngFramer({ onFrame: (f) => frames.push(f) });
    framer.feed(Buffer.concat([PNG_A, PNG_B]));
    const dot1 = detectIndicatorInFrame(frames[0], { color: 'light_blue' });
    const dot2 = detectIndicatorInFrame(frames[1], { color: 'light_blue' });
    expect(dot1).not.toBeNull();
    expect(dot2).not.toBeNull();
    expect(dot1.x).toBeGreaterThanOrEqual(45);
    expect(dot1.x).toBeLessThanOrEqual(55);
    expect(dot2.x).toBeGreaterThanOrEqual(95);
    expect(dot2.x).toBeLessThanOrEqual(105);
  });

  test('emits a frame when the first chunk ends exactly at the IEND boundary', () => {
    // Worst-case slicing: chunk ends exactly at the last byte of PNG_A.
    const frames = [];
    const framer = new PngFramer({ onFrame: (f) => frames.push(f) });
    framer.feed(PNG_A);
    framer.feed(PNG_B);
    expect(frames).toHaveLength(2);
    expect(frames[0].equals(PNG_A)).toBe(true);
    expect(frames[1].equals(PNG_B)).toBe(true);
  });

  test('handles a chunk boundary inside the 8-byte IEND marker', () => {
    // Slice in the middle of the 8-byte IEND tail: chunk one ends mid-IEND,
    // chunk two contains the rest of the IEND + the next PNG.
    const frames = [];
    const framer = new PngFramer({ onFrame: (f) => frames.push(f) });
    const split = PNG_A.length - 4; // splits the IEND tail in half
    framer.feed(PNG_A.slice(0, split));
    expect(frames).toEqual([]);
    framer.feed(Buffer.concat([PNG_A.slice(split), PNG_B]));
    expect(frames).toHaveLength(2);
    expect(frames[0].equals(PNG_A)).toBe(true);
    expect(frames[1].equals(PNG_B)).toBe(true);
  });
});
