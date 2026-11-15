'use strict';

// `mauto assert screenshot_match` compares against --reference (#281), through
// the same decision `mauto run` uses: pass is ok/exit 0, a mismatch is
// test_failed/exit 6, a missing baseline is ok with needs_agent, and every
// flag problem is caught before the device is touched.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { handleAssert, handleResultAddAssertion, buildProgram } = require('../../src/cli');
const { ResultStore } = require('../../src/result/store');
const { workspaceDir } = require('../../src/workspace/layout');
const { makeFakeBridge, makeFakeClock, el } = require('../helpers/fake-bridge');
const { solidPng, quadrantPng, writePng } = require('../helpers/png');

const WHITE = [255, 255, 255, 255];
const BLACK = [0, 0, 0, 255];

let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-assert-shot-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const refFile = (name = 'ref/home.png') => path.join(workspaceDir(root), name);
const deps = (bridge, extra = {}) => ({
  deviceBridge: bridge, projectRoot: root, clock: makeFakeClock(), loadConfig: () => null, ...extra,
});
const assertShot = (bridge, flags, extra) => handleAssert(deps(bridge, extra), 'screenshot_match', flags);

test('a matching screen passes: ok, exit 0, with the comparison in data and the hint', async () => {
  writePng(refFile(), solidPng(20, 20, WHITE));
  const r = await assertShot(makeFakeBridge({ screenshots: [solidPng(20, 20, WHITE)] }), { reference: 'ref/home.png' });
  expect(r.exitKind).toBe('ok');
  expect(r.envelope.ok).toBe(true);
  const { data } = r.envelope;
  expect(data).toMatchObject({
    type: 'screenshot_match', mechanical: true, pass: true, needs_agent: false, similarity_score: 1, diff_screenshot: null,
    reference_screenshot: path.relative(root, refFile()),
  });
  expect(data.actual_screenshot).toMatch(/screenshots[/\\]assert[/\\]assert_\d{8}_\d{6}_[0-9a-f]{6}[/\\]actual\.png$/);
  expect(fs.existsSync(path.join(root, data.actual_screenshot))).toBe(true);
  expect(r.envelope.hint).toBe(
    'Record it: mauto result add-assertion --run-id <run_id> --step-id <step_id> --type screenshot_match --pass true ' +
      `--message "<why>" --reference-screenshot "${data.reference_screenshot}" --actual-screenshot "${data.actual_screenshot}" ` +
      '--similarity-score 1'
  );
});

test('a different screen is test_failed with the similarity and the diff image', async () => {
  writePng(refFile(), solidPng(20, 20, WHITE));
  const bridge = makeFakeBridge({ screenshots: [quadrantPng(20, 20, WHITE, { quadrant: 'tl', rgba: BLACK })] });
  const r = await assertShot(bridge, { reference: 'ref/home.png' });
  expect(r.exitKind).toBe('test_failed');
  expect(r.envelope.ok).toBe(false);
  expect(r.envelope.error.kind).toBe('test_failed');
  expect(r.envelope.data.pass).toBe(false);
  expect(r.envelope.data.similarity_score).toBeCloseTo(0.75, 5);
  expect(r.envelope.data.diff_screenshot).toMatch(/diff\.png$/);
  expect(fs.existsSync(path.join(root, r.envelope.data.diff_screenshot))).toBe(true);
  expect(r.envelope.hint).toContain('--pass false');
  expect(r.envelope.hint).toContain('--similarity-score 0.75');
});

test('--tolerance and --mask decide too', async () => {
  writePng(refFile(), solidPng(20, 20, WHITE));
  const shot = quadrantPng(20, 20, WHITE, { quadrant: 'tl', rgba: BLACK });
  const loose = await assertShot(makeFakeBridge({ screenshots: [shot] }), { reference: 'ref/home.png', tolerance: '0.7' });
  expect(loose.exitKind).toBe('ok');
  const masked = await assertShot(
    makeFakeBridge({ screenshots: [shot], screenSize: { width: 20, height: 20 }, elements: [[el('Avatar', { bounds: [0, 0, 10, 10] })]] }),
    { reference: 'ref/home.png', mask: ['Avatar'] }
  );
  expect(masked.exitKind).toBe('ok');
  expect(masked.envelope.data.similarity_score).toBe(1);
});

test('a size mismatch is test_failed naming both sizes, with no --similarity-score in the hint', async () => {
  writePng(refFile(), solidPng(20, 30, WHITE));
  const r = await assertShot(makeFakeBridge({ screenshots: [solidPng(30, 20, WHITE)] }), { reference: 'ref/home.png' });
  expect(r.exitKind).toBe('test_failed');
  expect(r.envelope.data.message).toContain('reference is 20x30, actual is 30x20; never resampled');
  expect(r.envelope.data.similarity_score).toBeNull();
  expect(r.envelope.hint).not.toContain('--similarity-score');
});

test('a missing baseline is ok with needs_agent; the hint never invites judging it by eye', async () => {
  const r = await assertShot(makeFakeBridge({ screenshots: [solidPng(20, 20, WHITE)] }), { reference: 'ref/home.png' });
  expect(r.exitKind).toBe('ok');
  const { data, hint } = r.envelope;
  expect(data).toMatchObject({ needs_agent: true, pass: null, mechanical: false, similarity_score: null });
  // The execute guide: record a baseline only once the user confirms the
  // screen, else leave the assertion pending. Never an agent verdict.
  expect(hint).not.toContain('--judge agent');
  expect(hint).not.toMatch(/yourself/);
  expect(hint).toContain('--update-references');
  expect(hint).toContain('--pass pending');
  expect(hint).toBe(
    `No reference screenshot at ${data.reference_screenshot}. If the user confirms this screen is correct, ` +
      're-run with --update-references to record it; otherwise leave it pending: ' +
      'mauto result add-assertion --run-id <run_id> --step-id <step_id> --type screenshot_match --pass pending ' +
      `--message "<why>" --reference-screenshot "${data.reference_screenshot}" --actual-screenshot "${data.actual_screenshot}"`
  );
  expect(fs.existsSync(refFile())).toBe(false);
});

test('the pending command the missing-baseline hint prints is accepted by result add-assertion', async () => {
  const r = await assertShot(makeFakeBridge({ screenshots: [solidPng(20, 20, WHITE)] }), { reference: 'ref/home.png' });
  const { data } = r.envelope;
  const recorded = handleResultAddAssertion(
    { resultStoreFactory: (args) => new ResultStore(args), projectRoot: root },
    {
      runId: 'run_20261115_120000', stepId: 's1', type: 'screenshot_match', pass: 'pending', message: 'no baseline yet',
      referenceScreenshot: data.reference_screenshot, actualScreenshot: data.actual_screenshot,
    }
  );
  expect(recorded.exitKind).toBe('ok');
  expect(recorded.envelope.data.assertion).toMatchObject({
    status: 'needs_agent', judge: { by: 'none' },
    reference_screenshot: data.reference_screenshot, actual_screenshot: data.actual_screenshot,
  });
});

test('--update-references records the baseline and passes', async () => {
  const shot = solidPng(20, 20, WHITE);
  const r = await assertShot(makeFakeBridge({ screenshots: [shot] }), { reference: 'ref/home.png', updateReferences: true });
  expect(r.exitKind).toBe('ok');
  expect(r.envelope.data.message).toMatch(/^reference updated \(--update-references\)/);
  expect(fs.readFileSync(refFile())).toEqual(shot);
});

test('--update-references on an unsettled screen is test_failed and records no baseline', async () => {
  const bridge = makeFakeBridge({
    screenshots: (n) => (n % 2 ? solidPng(20, 20, WHITE) : solidPng(20, 20, BLACK)),
  });
  const r = await assertShot(bridge, { reference: 'ref/home.png', updateReferences: true });
  expect(r.exitKind).toBe('test_failed');
  expect(r.envelope.error.kind).toBe('test_failed');
  expect(r.envelope.data).toMatchObject({ pass: false, needs_agent: false, mechanical: true, similarity_score: null });
  expect(r.envelope.data.message).toMatch(/^screen did not settle within \d+ms; no reference recorded/);
  expect(fs.existsSync(refFile())).toBe(false);
});

describe('refusals, before the device is touched', () => {
  const untouched = () => makeFakeBridge({ screenshots: [solidPng(4, 4)] });

  test('no workspace -> environment, with a hint to run mauto setup', async () => {
    const bridge = untouched();
    const r = await assertShot(bridge, { reference: 'ref/home.png' }, { projectRoot: null });
    expect(r.exitKind).toBe('environment');
    expect(r.envelope.error.kind).toBe('environment');
    expect(r.envelope.hint).toContain('mauto setup');
    expect(bridge.calls).toEqual([]);
  });

  test('other assertion types still work without a workspace', async () => {
    const bridge = makeFakeBridge({ elements: [[el('Login')]] });
    const r = await handleAssert({ deviceBridge: bridge }, 'element_exists', { target: 'Login' });
    expect(r.exitKind).toBe('ok');
  });

  test.each([
    ['no --reference', {}, /--reference/],
    ['a blank --reference', { reference: ' ' }, /--reference/],
    ['a --tolerance above 1', { reference: 'r.png', tolerance: '1.5' }, /tolerance/],
    ['a non-numeric --tolerance', { reference: 'r.png', tolerance: 'high' }, /tolerance/],
    ['a negative --mask rect', { reference: 'r.png', mask: ['-1,0,5,5'] }, /mask/],
    ['a --reference outside the project', { reference: '../../../etc/x.png' }, /outside the project root/],
  ])('%s -> invalid_input', async (_name, flags, message) => {
    const bridge = untouched();
    const r = await assertShot(bridge, flags);
    expect(r.exitKind).toBe('invalid_input');
    expect(r.envelope.error.message).toMatch(message);
    expect(bridge.calls).toEqual([]);
  });
});

test('a device failure while capturing is the device kind', async () => {
  const bridge = makeFakeBridge({ methods: { screenshot: () => { throw new Error('device offline'); } } });
  const r = await assertShot(bridge, { reference: 'ref/home.png' });
  expect(r.exitKind).toBe('device');
  expect(r.envelope.error.message).toContain('device offline');
});

test('argv: --reference, --tolerance, repeated --mask and --update-references reach the comparison', async () => {
  const shot = solidPng(20, 20, WHITE);
  const bridge = makeFakeBridge({ screenshots: [shot], screenSize: { width: 20, height: 20 }, elements: [[el('Clock')]] });
  const emitted = [];
  // A fresh program per parse: commander keeps option values across parses.
  const program = () => buildProgram({
    projectRoot: root,
    deviceBridgeFactory: async () => ({ bridge, close: async () => {} }),
    emit: (r) => emitted.push(r),
    clock: makeFakeClock(),
  });
  await program().parseAsync([
    'node', 'mauto', 'assert', 'screenshot_match',
    '--reference', 'ref/home.png', '--tolerance', '0.95', '--mask', '0,0,5,5', '--mask', 'Clock', '--update-references',
  ]);
  expect(emitted).toHaveLength(1);
  expect(emitted[0].exitKind).toBe('ok');
  expect(fs.readFileSync(refFile())).toEqual(shot);

  // Now compare against it, masks and all.
  emitted.length = 0;
  await program().parseAsync([
    'node', 'mauto', 'assert', 'screenshot_match', '--reference', 'ref/home.png', '--mask', '0,0,5,5', '--mask', 'Clock',
  ]);
  expect(emitted[0].exitKind).toBe('ok');
  expect(emitted[0].envelope.data.similarity_score).toBe(1);
  expect(bridge.of('getScreenSize').length).toBeGreaterThan(0);
});
