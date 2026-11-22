'use strict';

// `mauto run` decides screenshot_match against a reference image (#281,
// replay slice R5b), end to end through handleRun on a fake bridge serving
// real PNGs: a missing baseline is left to an agent (the run finalizes
// incomplete), --update-references records it, a different screen fails.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ResultStore } = require('../../../src/result/store');
const { finalizeRun } = require('../../../src/cli');
const { handleRun } = require('../../../src/run/handle');
const { workspaceDir } = require('../../../src/workspace/layout');
const { makeFakeBridge, makeFakeClock, el } = require('../../helpers/fake-bridge');
const { solidPng, quadrantPng, writePng } = require('../../helpers/png');

const RUN_ID = 'run_20261115_120000';
const WHITE = [255, 255, 255, 255];
const BLACK = [0, 0, 0, 255];

let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-run-r5b-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const scenarioWith = (assertion) => ({
  $schema_version: '2.1',
  scenario_id: 'home',
  app_package: 'com.example.app',
  steps: [{ id: 'tap_more', action: 'tap', description: 'd', target: 'More' }],
  assertions: [{ id: 'home_looks_right', after_step: 'tap_more', type: 'screenshot_match', description: 'd', ...assertion }],
});

function prepared(sc) {
  const file = path.join(root, 'home.json');
  fs.writeFileSync(file, JSON.stringify(sc));
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  return { scenario: sc, runId: RUN_ID, file, sha256 };
}

const run = (bridge, sc, extra = {}) => handleRun(
  {
    bridge,
    resultStoreFactory: (args) => new ResultStore(args),
    memoryStoreFactory: null,
    projectRoot: root,
    finalizeRun,
    clock: makeFakeClock(),
    loadConfig: () => null,
  },
  { ...prepared(sc), ...extra }
);

const resultFile = () => JSON.parse(fs.readFileSync(path.join(workspaceDir(root), 'results', `${RUN_ID}.json`), 'utf8'));
const defaultRef = () => path.join(workspaceDir(root), 'screenshots', 'reference', 'home', 'home_looks_right.png');
const actualRel = path.join('.mobile-automator', 'screenshots', 'home', RUN_ID, 'assert_home_looks_right.png');
const refRel = path.join('.mobile-automator', 'screenshots', 'reference', 'home', 'home_looks_right.png');

const bridgeShowing = (png, extra = {}) => makeFakeBridge({ elements: [[el('More')]], screenshots: [png], ...extra });

test('a missing baseline is needs_agent and the run finalizes incomplete', async () => {
  const r = await run(bridgeShowing(solidPng(20, 20, WHITE)), scenarioWith({}));
  expect(r.exitKind).toBe('incomplete');
  const [a] = resultFile().assertion_results;
  expect(a).toMatchObject({
    assertion_id: 'home_looks_right',
    status: 'needs_agent',
    mechanical: false,
    judge: { by: 'none' },
    reference_screenshot: refRel,
    actual_screenshot: actualRel,
  });
  expect(a).not.toHaveProperty('similarity_score');
  expect(a.message).toContain('--update-references');
  expect(resultFile().status).toBe('incomplete');
  expect(r.envelope.data.pending.map((p) => p.assertion_id)).toEqual(['home_looks_right']);
});

test('--update-references writes the baseline and passes', async () => {
  const shot = solidPng(20, 20, WHITE);
  const r = await run(bridgeShowing(shot), scenarioWith({}), { updateReferences: true });
  expect(r.exitKind).toBe('ok');
  expect(fs.readFileSync(defaultRef())).toEqual(shot);
  const [a] = resultFile().assertion_results;
  expect(a).toMatchObject({
    status: 'passed', mechanical: true, judge: { by: 'reference_screenshot' }, similarity_score: 1, expected: null,
  });
  expect(a.message).toBe(`reference updated (--update-references): ${refRel}`);
});

test('--update-references on a screen that never settles fails the run and writes no baseline', async () => {
  const bridge = makeFakeBridge({
    elements: [[el('More')]],
    screenshots: (n) => (n % 2 ? solidPng(20, 20, WHITE) : solidPng(20, 20, BLACK)),
  });
  const r = await run(bridge, scenarioWith({}), { updateReferences: true });
  expect(r.exitKind).toBe('test_failed');
  expect(fs.existsSync(defaultRef())).toBe(false);
  const [a] = resultFile().assertion_results;
  expect(a).toMatchObject({ status: 'failed', mechanical: true, judge: { by: 'reference_screenshot' } });
  expect(a.message).toMatch(/^screen did not settle within \d+ms; no reference recorded \(\d+ frames captured\)$/);
  expect(a).not.toHaveProperty('similarity_score');
});

test('a matching screen passes against the recorded baseline', async () => {
  writePng(defaultRef(), solidPng(20, 20, WHITE));
  const r = await run(bridgeShowing(solidPng(20, 20, WHITE)), scenarioWith({}));
  expect(r.exitKind).toBe('ok');
  expect(resultFile().assertion_results[0]).toMatchObject({ status: 'passed', similarity_score: 1 });
});

test('a different screen fails the run with the similarity, and writes the diff', async () => {
  writePng(defaultRef(), solidPng(20, 20, WHITE));
  const r = await run(bridgeShowing(quadrantPng(20, 20, WHITE, { quadrant: 'bl', rgba: BLACK })), scenarioWith({}));
  expect(r.exitKind).toBe('test_failed');
  const [a] = resultFile().assertion_results;
  expect(a.status).toBe('failed');
  expect(a.similarity_score).toBeCloseTo(0.75, 5);
  expect(a.message).toContain('assert_home_looks_right.diff.png');
  expect(fs.existsSync(path.join(root, actualRel.replace(/\.png$/, '.diff.png')))).toBe(true);
  expect(r.envelope.data.failures[0]).toMatch(/^assertion home_looks_right \(screenshot_match\): screenshot differs/);
});

test('the scenario tolerance and an explicit reference_screenshot are honoured', async () => {
  writePng(path.join(workspaceDir(root), 'baselines', 'custom.png'), solidPng(20, 20, WHITE));
  const sc = scenarioWith({ reference_screenshot: 'baselines/custom.png', tolerance: 0.7 });
  const r = await run(bridgeShowing(quadrantPng(20, 20, WHITE, { quadrant: 'bl', rgba: BLACK })), sc);
  expect(r.exitKind).toBe('ok');
  expect(resultFile().assertion_results[0].reference_screenshot).toBe(path.join('.mobile-automator', 'baselines', 'custom.png'));
});

test('an element_description mask hides a changing element', async () => {
  writePng(defaultRef(), solidPng(20, 20, WHITE));
  const bridge = bridgeShowing(quadrantPng(20, 20, WHITE, { quadrant: 'tr', rgba: BLACK }), {
    screenSize: { width: 20, height: 20 },
    elements: [[el('More'), el('12:45', { bounds: [10, 0, 20, 10] })]],
  });
  const r = await run(bridge, scenarioWith({ masks: [{ element_description: '12:45' }] }));
  expect(r.exitKind).toBe('ok');
  expect(resultFile().assertion_results[0]).toMatchObject({ status: 'passed', similarity_score: 1 });
});

test('a size mismatch fails naming both sizes', async () => {
  writePng(defaultRef(), solidPng(20, 30, WHITE));
  const r = await run(bridgeShowing(solidPng(30, 20, WHITE)), scenarioWith({}));
  expect(r.exitKind).toBe('test_failed');
  const [a] = resultFile().assertion_results;
  expect(a.message).toContain('reference is 20x30, actual is 30x20; never resampled');
  expect(a).not.toHaveProperty('similarity_score');
});

test('a reference outside the project root fails the assertion, not the run', async () => {
  const r = await run(bridgeShowing(solidPng(20, 20, WHITE)), scenarioWith({ reference_screenshot: '../../../etc/x.png' }));
  expect(r.exitKind).toBe('test_failed');
  expect(resultFile().assertion_results[0].message).toMatch(/assertion errored: .*outside the project root/);
});

// #363: a committed link at the baseline is the checkout's fault. The run
// still finalizes (never left in progress), but it reports environment with
// the refusal's own message, not a failed assertion, and nothing of the
// target reaches the envelope.
test('a baseline that is a link ends the run environment', async () => {
  const { UnsafePathError } = require('../../../src/workspace/safe-fs');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-run-r5b-out-'));
  const secret = writePng(path.join(outside, 'secret.png'), solidPng(20, 20, BLACK));
  fs.mkdirSync(path.dirname(defaultRef()), { recursive: true });
  fs.symlinkSync(secret, defaultRef());
  await expect(run(bridgeShowing(solidPng(20, 20, WHITE)), scenarioWith({}))).rejects.toBeInstanceOf(UnsafePathError);
  expect(resultFile()._in_progress).toBeUndefined();
  fs.rmSync(outside, { recursive: true, force: true });
});
