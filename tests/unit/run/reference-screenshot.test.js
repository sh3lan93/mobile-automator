'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { compareScreenshots, pass } = require('../../../src/run/reference-screenshot');
const { workspaceDir } = require('../../../src/workspace/layout');
const { CANARY, tmpDir, snapshot } = require('../../helpers/workspace-safety');
const { solidPng, quadrantPng, writePng } = require('../../helpers/png');

const WHITE = [255, 255, 255, 255];
const BLACK = [0, 0, 0, 255];

// `dir` is the project root; the diff lands in the workspace beside the
// actual, as runArtifacts / assertArtifacts put it.
let dir;
let shots;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-refshot-'));
  shots = path.join(workspaceDir(dir), 'screenshots');
  fs.mkdirSync(shots, { recursive: true });
});

const file = (name, buf) => writePng(path.join(dir, name), buf);

describe('compareScreenshots', () => {
  test('identical images are similarity 1.0 and write no diff', () => {
    const referencePath = file('ref.png', solidPng(40, 40, WHITE));
    const actualPath = file('act.png', solidPng(40, 40, WHITE));
    const diffPath = path.join(shots, 'out', 'diff.png');
    const r = compareScreenshots({ projectRoot: dir, referencePath, actualPath, diffPath });
    expect(r).toMatchObject({ similarity: 1, diffPixels: 0, comparedPixels: 1600, dimensionsMismatch: null, diffPath: null, pass: true });
    expect(fs.existsSync(diffPath)).toBe(false);
  });

  test('one changed quadrant is similarity 0.75 and writes the diff image', () => {
    const referencePath = file('ref.png', solidPng(40, 40, WHITE));
    const actualPath = file('act.png', quadrantPng(40, 40, WHITE, { quadrant: 'br', rgba: BLACK }));
    // The diff lands beside the actual, whose directory the capture created.
    const diffPath = path.join(shots, 'diff.png');
    const r = compareScreenshots({ projectRoot: dir, referencePath, actualPath, diffPath });
    expect(r.similarity).toBeCloseTo(0.75, 5);
    expect(r.diffPixels).toBe(400);
    expect(r.comparedPixels).toBe(1600);
    expect(r.diffPath).toBe(diffPath);
    expect(fs.existsSync(diffPath)).toBe(true);
    expect(r.pass).toBe(false);
    expect(compareScreenshots({ referencePath, actualPath, tolerance: 0.7 }).pass).toBe(true);
  });

  test('masking the changed quadrant makes it similarity 1.0 and excludes the masked pixels', () => {
    const referencePath = file('ref.png', solidPng(40, 40, WHITE));
    const actualPath = file('act.png', quadrantPng(40, 40, WHITE, { quadrant: 'br', rgba: BLACK }));
    const r = compareScreenshots({ referencePath, actualPath, masks: [{ x: 20, y: 20, width: 20, height: 20 }] });
    expect(r.similarity).toBe(1);
    expect(r.diffPixels).toBe(0);
    expect(r.comparedPixels).toBe(1200);
    // The file on disk is untouched by the mask.
    expect(fs.readFileSync(actualPath)).toEqual(quadrantPng(40, 40, WHITE, { quadrant: 'br', rgba: BLACK }));
  });

  test('masks are clamped to the image and overlapping masks are counted once', () => {
    const referencePath = file('ref.png', solidPng(10, 10, WHITE));
    const actualPath = file('act.png', solidPng(10, 10, WHITE));
    const r = compareScreenshots({
      referencePath,
      actualPath,
      masks: [{ x: 5, y: 5, width: 50, height: 50 }, { x: 0, y: 0, width: 7, height: 7 }],
    });
    // 25 (5..9 x 5..9) + 49 (0..6 x 0..6) - 4 (5..6 x 5..6 overlap) = 70 masked.
    expect(r.comparedPixels).toBe(30);
  });

  test('everything masked compares nothing and is similarity 1', () => {
    const referencePath = file('ref.png', solidPng(10, 10, WHITE));
    const actualPath = file('act.png', solidPng(10, 10, BLACK));
    const r = compareScreenshots({ referencePath, actualPath, masks: [{ x: 0, y: 0, width: 10, height: 10 }] });
    expect(r).toMatchObject({ similarity: 1, comparedPixels: 0, diffPixels: 0 });
  });

  test('a dimension mismatch is similarity 0, names both sizes, and is never resampled', () => {
    const referencePath = file('ref.png', solidPng(108, 240, WHITE));
    const actualPath = file('act.png', solidPng(117, 253, WHITE));
    const diffPath = path.join(shots, 'diff.png');
    const r = compareScreenshots({ projectRoot: dir, referencePath, actualPath, diffPath });
    expect(r).toEqual({
      similarity: 0,
      diffPixels: null,
      comparedPixels: null,
      dimensionsMismatch: { reference: { width: 108, height: 240 }, actual: { width: 117, height: 253 } },
      diffPath: null,
      pass: false,
    });
    expect(fs.existsSync(diffPath)).toBe(false);
  });

  test('a mismatch with no diffPath writes nothing', () => {
    const referencePath = file('ref.png', solidPng(10, 10, WHITE));
    const actualPath = file('act.png', solidPng(10, 10, BLACK));
    const r = compareScreenshots({ referencePath, actualPath });
    expect(r.diffPath).toBeNull();
    expect(fs.readdirSync(dir).sort()).toEqual(['.mobile-automator', 'act.png', 'ref.png']);
    expect(fs.readdirSync(shots)).toEqual([]);
  });

  // #347: writeFileSync follows a link leaf, and the diff path is a
  // predictable name a cloned repo can plant. The atomic write's rename
  // replaces the link instead.
  test('a diff path planted as a link leaf is replaced, its outside target untouched', () => {
    const outside = tmpDir('mauto-refshot-outside-');
    const target = path.join(outside, 'keep.png');
    fs.writeFileSync(target, CANARY);
    const before = snapshot(outside);
    const diffPath = path.join(shots, 'diff.png');
    fs.symlinkSync(target, diffPath);
    const referencePath = file('ref.png', solidPng(40, 40, WHITE));
    const actualPath = file('act.png', quadrantPng(40, 40, WHITE, { quadrant: 'br', rgba: BLACK }));

    const r = compareScreenshots({ projectRoot: dir, referencePath, actualPath, diffPath });

    expect(r.diffPath).toBe(diffPath);
    expect(fs.lstatSync(diffPath).isFile()).toBe(true);
    expect(snapshot(outside)).toEqual(before);
  });

  test('an unreadable PNG throws', () => {
    const referencePath = path.join(dir, 'bad.png');
    fs.writeFileSync(referencePath, Buffer.from('nope'));
    const actualPath = file('act.png', solidPng(10, 10, WHITE));
    expect(() => compareScreenshots({ referencePath, actualPath })).toThrow();
  });
});

describe('pass', () => {
  test('similarity at or above the tolerance passes', () => {
    expect(pass(0.9, 0.9)).toBe(true);
    expect(pass(0.95, 0.9)).toBe(true);
    expect(pass(0.89, 0.9)).toBe(false);
  });

  test('a null similarity (dimension mismatch) never passes', () => {
    expect(pass(null, 0)).toBe(false);
  });
});
