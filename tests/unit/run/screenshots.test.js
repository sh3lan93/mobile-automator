'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  referencePathFor, resolveReference, captureStable, writeReference,
} = require('../../../src/run/screenshots');
const { workspaceDir } = require('../../../src/workspace/layout');
const { makeFakeBridge, makeFakeClock } = require('../../helpers/fake-bridge');
const { solidPng, writePng } = require('../../helpers/png');

let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-shots-'));
});

describe('referencePathFor', () => {
  test('is <workspace>/screenshots/reference/<scenario_id>/<assertion_id>.png', () => {
    expect(referencePathFor(root, 'login', 'assert_home')).toBe(
      path.join(workspaceDir(root), 'screenshots', 'reference', 'login', 'assert_home.png')
    );
  });

  test.each([['../x', 'a'], ['s', 'a/b'], ['s', '..'], ['', 'a'], ['s', 'a\\b']])(
    'refuses ids that are not one path segment (%p, %p)',
    (scenarioId, assertionId) => {
      expect(() => referencePathFor(root, scenarioId, assertionId)).toThrow(/path segment/);
    }
  );
});

describe('resolveReference', () => {
  test('absent reference_screenshot -> the default path', () => {
    expect(resolveReference(root, { id: 'a1' }, 'scn')).toBe(referencePathFor(root, 'scn', 'a1'));
  });

  test('a relative reference resolves against the workspace dir', () => {
    expect(resolveReference(root, { id: 'a1', reference_screenshot: 'screenshots/reference/x.png' }, 'scn'))
      .toBe(path.join(workspaceDir(root), 'screenshots', 'reference', 'x.png'));
  });

  test('a relative reference may step out of the workspace but not out of the project', () => {
    expect(resolveReference(root, { id: 'a1', reference_screenshot: '../baselines/x.png' }, 'scn'))
      .toBe(path.join(root, 'baselines', 'x.png'));
    expect(() => resolveReference(root, { id: 'a1', reference_screenshot: '../../etc/passwd' }, 'scn'))
      .toThrow(/outside the project/);
  });

  test('an absolute reference is allowed only inside the project root', () => {
    const inside = path.join(root, 'refs', 'x.png');
    expect(resolveReference(root, { id: 'a1', reference_screenshot: inside }, 'scn')).toBe(inside);
    expect(() => resolveReference(root, { id: 'a1', reference_screenshot: path.join(os.tmpdir(), 'x.png') }, 'scn'))
      .toThrow(/outside the project/);
  });
});

describe('writeReference', () => {
  test('copies the actual to the reference path, creating its directory', () => {
    const actual = writePng(path.join(root, 'a.png'), solidPng(4, 4));
    const ref = path.join(root, 'deep', 'er', 'ref.png');
    writeReference(actual, ref);
    expect(fs.readFileSync(ref)).toEqual(fs.readFileSync(actual));
  });
});

describe('captureStable', () => {
  const frames = (...bufs) => ({
    screenshot: ([dest], n) => {
      fs.writeFileSync(dest, bufs[Math.min(n, bufs.length) - 1]);
      return dest;
    },
  });
  const A = solidPng(8, 8, [255, 0, 0, 255]);
  const B = solidPng(8, 8, [0, 255, 0, 255]);
  const C = solidPng(8, 8, [0, 0, 255, 255]);

  test('captures until two consecutive frames are identical and leaves the last one at dest', async () => {
    const bridge = makeFakeBridge({ methods: frames(A, B, C, C) });
    const clock = makeFakeClock();
    const dest = path.join(root, 'out', 'shot.png');
    const r = await captureStable({ bridge, dest, clock, timeoutMs: 10000, pollMs: 100 });
    expect(r).toEqual({ path: dest, stable: true, frames: 4 });
    expect(fs.readFileSync(dest)).toEqual(C);
    expect(fs.readdirSync(path.dirname(dest))).toEqual(['shot.png']);
    expect(clock.now()).toBe(300);
  });

  test('a screen that never settles is stable:false, bounded by the timeout', async () => {
    const bridge = makeFakeBridge({
      methods: { screenshot: ([dest], n) => fs.writeFileSync(dest, n % 2 ? A : B) },
    });
    const clock = makeFakeClock();
    const dest = path.join(root, 'shot.png');
    const r = await captureStable({ bridge, dest, clock, timeoutMs: 1000, pollMs: 250 });
    expect(r.stable).toBe(false);
    expect(r.frames).toBe(5);
    expect(clock.now()).toBe(1000);
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.readdirSync(root)).toEqual(['shot.png']);
  });

  test('a frame that is not a PNG is an error naming it, and leaves no temp files', async () => {
    const bridge = makeFakeBridge();
    const dest = path.join(root, 'shot.png');
    await expect(captureStable({ bridge, dest, clock: makeFakeClock(), timeoutMs: 1000, pollMs: 100 }))
      .rejects.toThrow(/not a readable PNG/);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  test('a capture that writes nothing is an error', async () => {
    const bridge = makeFakeBridge({ methods: { screenshot: () => null } });
    await expect(captureStable({ bridge, dest: path.join(root, 's.png'), clock: makeFakeClock(), timeoutMs: 100, pollMs: 10 }))
      .rejects.toThrow(/not a readable PNG/);
  });
});
