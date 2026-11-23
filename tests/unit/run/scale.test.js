'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { scaleFactor, pointsToPixels, boundsToRect, pngSize } = require('../../../src/run/scale');
const { solidPng, writePng } = require('../../helpers/png');

describe('scaleFactor', () => {
  test('an iOS @3x screenshot is factor 3 against the point screen size', () => {
    expect(scaleFactor(1170, { width: 390, height: 844 })).toBe(3);
  });

  test('an Android screenshot is factor 1 against its pixel screen size', () => {
    expect(scaleFactor(1080, { width: 1080, height: 2400 })).toBe(1);
  });

  test.each([
    ['zero width', 1080, { width: 0, height: 10 }],
    ['missing size', 1080, null],
    ['NaN png width', NaN, { width: 390, height: 844 }],
    ['negative png width', -5, { width: 390, height: 844 }],
  ])('%s throws a clear error', (_name, pngWidth, size) => {
    expect(() => scaleFactor(pngWidth, size)).toThrow(/scale factor/);
  });
});

describe('pointsToPixels', () => {
  test('multiplies and rounds', () => {
    expect(pointsToPixels({ x: 10.2, y: 20, width: 100.5, height: 33.3 }, 3))
      .toEqual({ x: 31, y: 60, width: 302, height: 100 });
  });

  test('factor 1 is the identity on integers', () => {
    expect(pointsToPixels({ x: 1, y: 2, width: 3, height: 4 }, 1)).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });
});

describe('boundsToRect', () => {
  test('turns element-model [x1, y1, x2, y2] bounds into a rect', () => {
    expect(boundsToRect([10, 20, 110, 70])).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  test('refuses anything else', () => {
    expect(() => boundsToRect(null)).toThrow(/bounds/);
    expect(() => boundsToRect([1, 2, 3])).toThrow(/bounds/);
    expect(() => boundsToRect([1, 2, 'x', 4])).toThrow(/bounds/);
  });
});

describe('pngSize', () => {
  test('reads width and height from a PNG file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-scale-'));
    const file = writePng(path.join(dir, 'a.png'), solidPng(30, 12));
    expect(pngSize(dir, file)).toEqual({ width: 30, height: 12 });
  });
});

describe('pngSize reads through the checked walk (#363)', () => {
  test('a PNG linked into the workspace is refused', () => {
    const { UnsafePathError } = require('../../../src/workspace/safe-fs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-scale-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-scale-out-'));
    const secret = writePng(path.join(outside, 's.png'), solidPng(30, 12));
    fs.mkdirSync(path.join(dir, '.mobile-automator'));
    fs.symlinkSync(secret, path.join(dir, '.mobile-automator', 'a.png'));
    expect(() => pngSize(dir, path.join(dir, '.mobile-automator', 'a.png'))).toThrow(UnsafePathError);
  });
});
