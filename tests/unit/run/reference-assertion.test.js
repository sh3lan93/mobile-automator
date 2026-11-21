'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  decideReferenceScreenshot, toleranceOf, masksOf, parseMaskSpec,
} = require('../../../src/run/reference-assertion');
const { findFirst } = require('../../../src/assertion/evaluator');
const { toEvaluatorInput, fromCliFlags, toCliFlags } = require('../../../src/assertion/fields');
const { makeFakeBridge, makeFakeClock, el } = require('../../helpers/fake-bridge');
const { workspaceDir } = require('../../../src/workspace/layout');
const { UnsafePathError } = require('../../../src/workspace/safe-fs');
const { CANARY, tmpDir, snapshot } = require('../../helpers/workspace-safety');
const { solidPng, quadrantPng, writePng } = require('../../helpers/png');

const WHITE = [255, 255, 255, 255];
const BLACK = [0, 0, 0, 255];

let root;
let referencePath;
let actualPath;
let diffPath;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-refassert-'));
  referencePath = path.join(root, 'ref', 'a.png');
  // The actual and its diff land under the workspace, as runArtifacts /
  // assertArtifacts put them (#347 confines them there).
  actualPath = path.join(workspaceDir(root), 'screenshots', 'demo', 'run_1', 'assert_a.png');
  diffPath = path.join(workspaceDir(root), 'screenshots', 'demo', 'run_1', 'assert_a.diff.png');
});

// The verdict body plus the diff, flattened so each test reads one object.
// `tolerance` and `timeoutMs`/`pollMs` are spelled as the callers' inputs: an
// evaluator input field and the run settings.
const decide = async (bridge, { tolerance, timeoutMs = 1000, pollMs = 100, ...extra } = {}) => {
  const { verdict, diff } = await decideReferenceScreenshot({
    bridge,
    clock: makeFakeClock(),
    settings: { defaultTimeoutMs: timeoutMs, pollMs },
    projectRoot: root,
    input: { type: 'screenshot_match', ...(tolerance === undefined ? {} : { tolerance }) },
    paths: { reference: referencePath, actual: actualPath, diff: diffPath },
    findFirst,
    ...extra,
  });
  return { ...verdict, diff_screenshot: diff };
};
const rel = (p) => path.relative(root, p);

describe('decideReferenceScreenshot', () => {
  test('--update-references records the actual as the baseline and passes', async () => {
    const bridge = makeFakeBridge({ screenshots: [solidPng(20, 20, WHITE)] });
    const v = await decide(bridge, { updateReferences: true });
    expect(v).toMatchObject({
      status: 'passed', mechanical: true, judge: { by: 'reference_screenshot' }, similarity_score: 1,
      reference_screenshot: rel(referencePath), actual_screenshot: rel(actualPath),
    });
    expect(v.message).toBe(`reference updated (--update-references): ${rel(referencePath)}`);
    expect(fs.readFileSync(referencePath)).toEqual(solidPng(20, 20, WHITE));
  });

  test('a missing baseline is needs_agent, naming the path and --update-references', async () => {
    const bridge = makeFakeBridge({ screenshots: [solidPng(20, 20, WHITE)] });
    const v = await decide(bridge);
    expect(v).toMatchObject({ status: 'needs_agent', mechanical: false, judge: { by: 'none' }, similarity_score: null });
    expect(v.message).toContain(rel(referencePath));
    expect(v.message).toContain('--update-references');
    expect(fs.existsSync(referencePath)).toBe(false);
    expect(fs.existsSync(actualPath)).toBe(true);
  });

  test('a matching screen passes with its similarity', async () => {
    writePng(referencePath, solidPng(20, 20, WHITE));
    const bridge = makeFakeBridge({ screenshots: [solidPng(20, 20, WHITE)] });
    const v = await decide(bridge);
    expect(v).toMatchObject({ status: 'passed', similarity_score: 1, diff_screenshot: null });
    expect(v.message).toMatch(/similarity 1\.000 >= tolerance 0\.900/);
    expect(bridge.of('getScreenSize')).toHaveLength(0);
  });

  test('a changed quadrant fails, writes the diff image and names it', async () => {
    writePng(referencePath, solidPng(20, 20, WHITE));
    const bridge = makeFakeBridge({ screenshots: [quadrantPng(20, 20, WHITE, { quadrant: 'tl', rgba: BLACK })] });
    const v = await decide(bridge);
    expect(v.status).toBe('failed');
    expect(v.similarity_score).toBeCloseTo(0.75, 5);
    expect(v.diff_screenshot).toBe(rel(diffPath));
    expect(fs.existsSync(diffPath)).toBe(true);
    expect(v.message).toMatch(/similarity 0\.750 < tolerance 0\.900 \(100 of 400 pixels differ\); diff image: /);
  });

  test('the assertion tolerance decides', async () => {
    writePng(referencePath, solidPng(20, 20, WHITE));
    const bridge = makeFakeBridge({ screenshots: [quadrantPng(20, 20, WHITE, { quadrant: 'tl', rgba: BLACK })] });
    expect((await decide(bridge, { tolerance: 0.7 })).status).toBe('passed');
  });

  test('a size mismatch fails naming both sizes, with no similarity', async () => {
    writePng(referencePath, solidPng(108, 240, WHITE));
    const bridge = makeFakeBridge({ screenshots: [solidPng(117, 253, WHITE)] });
    const v = await decide(bridge);
    expect(v).toMatchObject({ status: 'failed', similarity_score: null, judge: { by: 'reference_screenshot' } });
    expect(v.message).toContain('reference is 108x240, actual is 117x253; never resampled');
  });

  test('an element_description mask covers the element, scaled from points to pixels (iOS @3x)', async () => {
    // 30x30 px PNG of a 10x10 pt screen; the changed quadrant is px 15..29 x 0..14.
    writePng(referencePath, solidPng(30, 30, WHITE));
    const bridge = makeFakeBridge({
      platform: 'ios',
      screenSize: { width: 10, height: 10 },
      screenshots: [quadrantPng(30, 30, WHITE, { quadrant: 'tr', rgba: BLACK })],
      elements: [[el('Clock', { bounds: [5, 0, 10, 5] })]],
    });
    const v = await decide(bridge, { masks: [{ element_description: 'clock' }] });
    expect(v.status).toBe('passed');
    expect(v.similarity_score).toBe(1);
  });

  test('a rect mask is in screen coordinates', async () => {
    writePng(referencePath, solidPng(30, 30, WHITE));
    const bridge = makeFakeBridge({
      screenSize: { width: 10, height: 10 },
      screenshots: [quadrantPng(30, 30, WHITE, { quadrant: 'tr', rgba: BLACK })],
    });
    const v = await decide(bridge, { masks: [{ x: 5, y: 0, width: 5, height: 5 }] });
    expect(v.status).toBe('passed');
    expect(bridge.of('listElements')).toHaveLength(0);
  });

  test('a mask element that is not on screen fails, naming it', async () => {
    writePng(referencePath, solidPng(20, 20, WHITE));
    const bridge = makeFakeBridge({ screenshots: [solidPng(20, 20, WHITE)], elements: [[el('Other')]] });
    const v = await decide(bridge, { masks: [{ element_description: 'Clock' }] });
    expect(v.status).toBe('failed');
    expect(v.message).toContain('mask element "Clock" was not found');
  });

  test('a bad tolerance or mask throws before the device is touched', async () => {
    const bridge = makeFakeBridge({ screenshots: [solidPng(20, 20, WHITE)] });
    await expect(decide(bridge, { tolerance: 2 })).rejects.toThrow(/tolerance/);
    await expect(decide(bridge, { masks: [{ x: -1, y: 0, width: 1, height: 1 }] })).rejects.toThrow(/mask 1/);
    expect(bridge.of('screenshot')).toHaveLength(0);
  });

  test('an unsettled screen is still compared, and the message says so', async () => {
    writePng(referencePath, solidPng(20, 20, WHITE));
    const bridge = makeFakeBridge({
      screenshots: (n) => (n % 2 ? solidPng(20, 20, WHITE) : solidPng(20, 20, BLACK)),
    });
    const v = await decide(bridge, { timeoutMs: 300, pollMs: 100 });
    expect(v).not.toHaveProperty('stable');
    expect(v.message).toMatch(/did not settle within 300ms/);
  });

  // #347: the baseline directory is a predictable path a cloned repo can
  // commit as a link; recording through it would write outside the project.
  test('--update-references refuses a baseline directory planted as a link, leaving its target unchanged', async () => {
    const outside = tmpDir('mauto-refassert-outside-');
    fs.writeFileSync(path.join(outside, 'a.png'), CANARY);
    const before = snapshot(outside);
    fs.symlinkSync(outside, path.join(root, 'ref'));
    const bridge = makeFakeBridge({ screenshots: [solidPng(20, 20, WHITE)] });

    await expect(decide(bridge, { updateReferences: true })).rejects.toThrow(UnsafePathError);
    expect(snapshot(outside)).toEqual(before);
  });

  test('--update-references on an unsettled screen fails and records no baseline', async () => {
    const bridge = makeFakeBridge({
      screenshots: (n) => (n % 2 ? solidPng(20, 20, WHITE) : solidPng(20, 20, BLACK)),
    });
    const v = await decide(bridge, { updateReferences: true, timeoutMs: 300, pollMs: 100 });
    expect(v).toMatchObject({
      status: 'failed', mechanical: true, judge: { by: 'reference_screenshot' }, similarity_score: null,
    });
    expect(v.message).toBe('screen did not settle within 300ms; no reference recorded (4 frames captured)');
    expect(v).not.toHaveProperty('stable');
    expect(fs.existsSync(referencePath)).toBe(false);
  });

  test('the verdict is exactly the record body, and the diff rides beside it', async () => {
    writePng(referencePath, solidPng(20, 20, WHITE));
    const bridge = makeFakeBridge({ screenshots: [solidPng(20, 20, WHITE)] });
    const r = await decideReferenceScreenshot({
      bridge,
      clock: makeFakeClock(),
      settings: { defaultTimeoutMs: 1000, pollMs: 100 },
      projectRoot: root,
      input: { type: 'screenshot_match' },
      paths: { reference: referencePath, actual: actualPath, diff: diffPath },
      findFirst,
    });
    expect(Object.keys(r).sort()).toEqual(['diff', 'verdict']);
    expect(Object.keys(r.verdict).sort()).toEqual([
      'actual_screenshot', 'judge', 'mechanical', 'message', 'reference_screenshot', 'similarity_score', 'status',
    ]);
    expect(r.diff).toBeNull();
  });
});

describe('toleranceOf', () => {
  test.each([[undefined, 0.9], [null, 0.9], [0, 0], [1, 1], ['0.5', 0.5]])('%p -> %p', (input, want) => {
    expect(toleranceOf(input)).toBe(want);
  });
  test.each([[-0.1], [1.1], ['abc'], ['']])('%p throws', (input) => {
    expect(() => toleranceOf(input)).toThrow(/tolerance/);
  });
});

describe('masksOf / parseMaskSpec', () => {
  test('absent masks are none', () => {
    expect(masksOf(undefined)).toEqual([]);
  });
  test('a non-array is refused', () => {
    expect(() => masksOf({})).toThrow(/array/);
  });
  test('four numbers are a rect, anything else an element description', () => {
    expect(parseMaskSpec('1,2,3,4')).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(parseMaskSpec(' 1, 2.5 ,3,4')).toEqual({ x: 1, y: 2.5, width: 3, height: 4 });
    expect(parseMaskSpec('Status bar')).toEqual({ element_description: 'Status bar' });
    expect(parseMaskSpec('1,2,3')).toEqual({ element_description: '1,2,3' });
  });
  test('a negative rect is refused', () => {
    expect(() => parseMaskSpec('-1,2,3,4')).toThrow(/mask/);
  });
});

describe('one input for both paths (src/assertion/fields.js)', () => {
  // `mauto run` builds the decision's input with toEvaluatorInput(a);
  // `mauto assert` with fromCliFlags over the flags an agent copies from
  // toCliFlags(a). Commander keys these flags by their own name.
  const a = {
    id: 'home', type: 'screenshot_match', after_step: 's1', reference_screenshot: 'ref/a.png', tolerance: 0.7,
  };
  const parsed = (argv) => Object.fromEntries(
    argv.flatMap((v, i) => (i % 2 ? [] : [[v.replace(/^--/, ''), argv[i + 1]]]))
  );

  test('toEvaluatorInput(a) is fromCliFlags(type, flags of toCliFlags(a))', () => {
    const runInput = toEvaluatorInput(a);
    const assertInput = fromCliFlags('screenshot_match', parsed(toCliFlags(a)));
    expect(assertInput).toEqual(runInput);
    expect(runInput).toEqual({ type: 'screenshot_match', reference_screenshot: 'ref/a.png', tolerance: '0.7' });
  });

  test('so the same screen gets the same verdict from either input', async () => {
    writePng(referencePath, solidPng(20, 20, WHITE));
    const shot = quadrantPng(20, 20, WHITE, { quadrant: 'tl', rgba: BLACK });
    const run = await decide(makeFakeBridge({ screenshots: [shot] }), { input: toEvaluatorInput(a) });
    const cli = await decide(makeFakeBridge({ screenshots: [shot] }), {
      input: fromCliFlags('screenshot_match', parsed(toCliFlags(a))),
    });
    expect(cli).toEqual(run);
    // 0.75 similarity: passes only because the scenario's 0.7 reached the
    // decision (the default 0.9 would fail it).
    expect(run.status).toBe('passed');
  });
});
