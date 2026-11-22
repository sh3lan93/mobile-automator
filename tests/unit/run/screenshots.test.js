'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  referencePathFor, resolveReference, runArtifacts, assertArtifacts, captureStable, writeReference,
} = require('../../../src/run/screenshots');
const { workspaceDir } = require('../../../src/workspace/layout');
const { UnsafePathError } = require('../../../src/workspace/safe-fs');
const { CANARY, tmpDir, snapshot } = require('../../helpers/workspace-safety');
const { makeFakeBridge, makeFakeClock } = require('../../helpers/fake-bridge');
const { solidPng, writePng } = require('../../helpers/png');

let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-shots-'));
});

// An outside directory holding a canary: a refused write must leave it
// byte-identical (snapshot before and after).
function outsideDir() {
  const dir = tmpDir('mauto-shots-outside-');
  fs.writeFileSync(path.join(dir, 'keep.png'), CANARY);
  return dir;
}

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
    writeReference(root, actual, ref);
    expect(fs.readFileSync(ref)).toEqual(fs.readFileSync(actual));
  });

  // #347: copyFileSync follows a link at its destination, and a cloned repo
  // can commit the baseline directory as one.
  test('refuses screenshots/reference planted as a link to outside, leaving it unchanged', () => {
    const outside = outsideDir();
    const before = snapshot(outside);
    fs.mkdirSync(path.join(workspaceDir(root), 'screenshots'), { recursive: true });
    fs.symlinkSync(outside, path.join(workspaceDir(root), 'screenshots', 'reference'));
    const actual = writePng(path.join(workspaceDir(root), 'screenshots', 'a.png'), solidPng(4, 4));

    expect(() => writeReference(root, actual, referencePathFor(root, 'login', 'keep')))
      .toThrow(UnsafePathError);
    expect(snapshot(outside)).toEqual(before);
  });

  test('refuses an explicit project-relative baseline whose directory is a link to outside', () => {
    const outside = outsideDir();
    const before = snapshot(outside);
    fs.symlinkSync(outside, path.join(root, 'baselines'));
    const actual = writePng(path.join(workspaceDir(root), 'screenshots', 'a.png'), solidPng(4, 4));
    const ref = resolveReference(root, { id: 'a1', reference_screenshot: '../baselines/keep.png' }, 'scn');

    expect(() => writeReference(root, actual, ref)).toThrow(UnsafePathError);
    expect(snapshot(outside)).toEqual(before);
  });

  test('replaces a baseline planted as a link leaf, never writing through it', () => {
    const outside = outsideDir();
    const before = snapshot(outside);
    const ref = referencePathFor(root, 'login', 'home');
    fs.mkdirSync(path.dirname(ref), { recursive: true });
    fs.symlinkSync(path.join(outside, 'keep.png'), ref);
    const actual = writePng(path.join(workspaceDir(root), 'screenshots', 'a.png'), solidPng(4, 4));

    writeReference(root, actual, ref);

    expect(fs.lstatSync(ref).isFile()).toBe(true);
    expect(fs.readFileSync(ref)).toEqual(fs.readFileSync(actual));
    expect(snapshot(outside)).toEqual(before);
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

  // The capture lands under the workspace, as runArtifacts / assertArtifacts
  // put it; its directory is created by the checked walk.
  const shotIn = (...p) => path.join(workspaceDir(root), 'screenshots', ...p);

  test('captures until two consecutive frames are identical and leaves the last one at dest', async () => {
    const bridge = makeFakeBridge({ methods: frames(A, B, C, C) });
    const clock = makeFakeClock();
    const dest = shotIn('out', 'shot.png');
    const r = await captureStable({ projectRoot: root, bridge, dest, clock, timeoutMs: 10000, pollMs: 100 });
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
    const dest = shotIn('shot.png');
    const r = await captureStable({ projectRoot: root, bridge, dest, clock, timeoutMs: 1000, pollMs: 250 });
    expect(r.stable).toBe(false);
    expect(r.frames).toBe(5);
    expect(clock.now()).toBe(1000);
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.readdirSync(shotIn())).toEqual(['shot.png']);
  });

  test('a frame that is not a PNG is an error naming it, and leaves no temp files', async () => {
    const bridge = makeFakeBridge();
    const dest = shotIn('shot.png');
    await expect(captureStable({ projectRoot: root, bridge, dest, clock: makeFakeClock(), timeoutMs: 1000, pollMs: 100 }))
      .rejects.toThrow(/not a readable PNG/);
    expect(fs.readdirSync(shotIn())).toEqual([]);
  });

  test('a capture that writes nothing is an error', async () => {
    const bridge = makeFakeBridge({ methods: { screenshot: () => null } });
    await expect(captureStable({ projectRoot: root, bridge, dest: shotIn('s.png'), clock: makeFakeClock(), timeoutMs: 100, pollMs: 10 }))
      .rejects.toThrow(/not a readable PNG/);
  });

  // #347: the engine writes each frame, so a committed
  // `screenshots/<scenario> -> elsewhere` would land them there.
  test('refuses screenshots/<scenario> planted as a link before any capture', async () => {
    const outside = outsideDir();
    const before = snapshot(outside);
    fs.mkdirSync(shotIn(), { recursive: true });
    fs.symlinkSync(outside, shotIn('login'));
    const bridge = makeFakeBridge({ methods: frames(A, A) });

    await expect(
      captureStable({ projectRoot: root, bridge, dest: shotIn('login', 'run_1', 'assert_a.png'), clock: makeFakeClock(), timeoutMs: 1000, pollMs: 100 })
    ).rejects.toThrow(UnsafePathError);
    expect(bridge.of('screenshot')).toEqual([]);
    expect(snapshot(outside)).toEqual(before);
  });
});

describe('runArtifacts', () => {
  const shots = (...p) => path.join(workspaceDir(root), 'screenshots', ...p);

  test('the default baseline, and the actual and diff beside the run evidence', () => {
    expect(runArtifacts({
      projectRoot: root, scenarioId: 'login', runId: 'run_20261115_120000', assertionId: 'a1', input: { type: 'screenshot_match' },
    })).toEqual({
      reference: shots('reference', 'login', 'a1.png'),
      actual: shots('login', 'run_20261115_120000', 'assert_a1.png'),
      diff: shots('login', 'run_20261115_120000', 'assert_a1.diff.png'),
    });
  });

  test('an explicit reference_screenshot in the input wins, and is kept inside the project', () => {
    const args = { projectRoot: root, scenarioId: 'login', runId: 'run_1', assertionId: 'a1' };
    expect(runArtifacts({ ...args, input: { reference_screenshot: 'baselines/x.png' } }).reference)
      .toBe(path.join(workspaceDir(root), 'baselines', 'x.png'));
    expect(() => runArtifacts({ ...args, input: { reference_screenshot: '../../etc/x.png' } })).toThrow(/outside the project/);
  });
});

describe('assertArtifacts', () => {
  const now = new Date('2026-11-15T12:34:56.789Z');

  test('the named baseline, and a fresh stamped directory for the actual and diff', () => {
    const p = assertArtifacts({ projectRoot: root, input: { reference_screenshot: 'ref/home.png' }, now });
    expect(p.reference).toBe(path.join(workspaceDir(root), 'ref', 'home.png'));
    const dir = path.dirname(p.actual);
    expect(path.dirname(dir)).toBe(path.join(workspaceDir(root), 'screenshots', 'assert'));
    expect(path.basename(dir)).toMatch(/^assert_20261115_123456_[0-9a-f]{6}$/);
    expect(p.actual).toBe(path.join(dir, 'actual.png'));
    expect(p.diff).toBe(path.join(dir, 'diff.png'));
  });

  test('two calls in the same second get different directories', () => {
    const input = { reference_screenshot: 'ref/home.png' };
    expect(assertArtifacts({ projectRoot: root, input, now }).actual)
      .not.toBe(assertArtifacts({ projectRoot: root, input, now }).actual);
  });

  test('refuses a missing reference and one outside the project', () => {
    expect(() => assertArtifacts({ projectRoot: root, input: {}, now })).toThrow(/reference/);
    expect(() => assertArtifacts({ projectRoot: root, input: { reference_screenshot: '../../x.png' }, now }))
      .toThrow(/outside the project/);
  });

  test('makes no directory: the capture and writeReference do', () => {
    assertArtifacts({ projectRoot: root, input: { reference_screenshot: 'ref/home.png' }, now });
    expect(fs.readdirSync(root)).toEqual([]);
  });
});
