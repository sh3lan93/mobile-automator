'use strict';

// Test-outcome exit codes through the REAL bin (#273).
//
// Spawned rather than in-process because the contract under test is the
// process exit code itself: the handler's exitKind is only half of it, and
// withEnvelope/emit must turn `test_failed` into 6 and still print exactly one
// envelope. A CI step branches on this without parsing JSON.
//
// The fixture has a `.git` at its project root so workspace discovery stops
// there and cannot wander into whatever sits above os.tmpdir().

const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'bin', 'mauto.js');
const RUN_ID = 'run_20261027_120000';

function childEnv() {
  const env = { ...process.env, MAUTO_LOG_LEVEL: 'info' };
  delete env.MAUTO_LOG_DIR;
  delete env.MAUTO_RUN_ID;
  return env;
}

function runCli(args, cwd) {
  const res = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env: childEnv() });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

// Exactly one envelope on stdout — the contract, so assert it, not just parse
// the last line.
function onlyEnvelope(r) {
  const lines = r.stdout.trim().split('\n').filter(Boolean);
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]);
}

describe('result finalize exit codes (integration, #273)', () => {
  let root;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-exitcodes-')));
    fs.mkdirSync(path.join(root, '.git'));
    const setup = runCli(['setup', '--mode', 'platform-aware'], root);
    expect(setup.status).toBe(0);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('--status failed exits 6 with a test_failed envelope, and the result is still written', () => {
    const r = runCli(['result', 'finalize', '--run-id', RUN_ID, '--scenario-id', 'y', '--status', 'failed'], root);
    expect(r.status).toBe(6);
    const env = onlyEnvelope(r);
    expect(env.ok).toBe(false);
    expect(env.error.kind).toBe('test_failed');
    expect(env.data.status).toBe('failed');
    expect(fs.existsSync(path.join(root, '.mobile-automator', 'results', `${RUN_ID}.json`))).toBe(true);
  });

  test('--status passed exits 0 with an ok envelope', () => {
    const add = runCli(['result', 'add-step', '--run-id', RUN_ID, '--scenario-id', 'y', '--step-id', 's1', '--status', 'pass'], root);
    expect(add.status).toBe(0);
    const r = runCli(['result', 'finalize', '--run-id', RUN_ID, '--scenario-id', 'y', '--status', 'passed'], root);
    expect(r.status).toBe(0);
    const env = onlyEnvelope(r);
    expect(env.ok).toBe(true);
    expect(env.data.status).toBe('passed');
  });

  // #286 review: the enum must be enforced or the exit-6 contract leaks — a
  // case variant of a DOCUMENTED value used to persist verbatim (a
  // schema-invalid file) with a green exit. Rejected before anything is
  // written, through the real bin.
  test('--status FAILED (a case variant) exits 3 with invalid_input and writes no file', () => {
    const r = runCli(['result', 'finalize', '--run-id', RUN_ID, '--scenario-id', 'y', '--status', 'FAILED'], root);
    expect(r.status).toBe(3);
    const env = onlyEnvelope(r);
    expect(env.ok).toBe(false);
    expect(env.error.kind).toBe('invalid_input');
    expect(env.hint).toContain('passed | failed | error');
    expect(fs.existsSync(path.join(root, '.mobile-automator', 'results', `${RUN_ID}.json`))).toBe(false);
  });

  // #286 review: same boundary for add-step — an unknown status used to be
  // silently recorded as 'error' with a green exit.
  test('add-step --status bogus exits 3 with invalid_input and writes no file', () => {
    const r = runCli(['result', 'add-step', '--run-id', RUN_ID, '--step-id', 'launch', '--status', 'bogus'], root);
    expect(r.status).toBe(3);
    const env = onlyEnvelope(r);
    expect(env.ok).toBe(false);
    expect(env.error.kind).toBe('invalid_input');
    expect(env.hint).toContain('pass | fail | skipped | error');
    expect(fs.existsSync(path.join(root, '.mobile-automator', 'results', `${RUN_ID}.json`))).toBe(false);
  });
});

// #296: omitting --status derived the verdict from assertions only, so a run
// whose step failed exited 0 and was harvested into run-history as a pass,
// while the JUnit export of the same run was red.
describe('derived status (#296)', () => {
  let root;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-derived-')));
    fs.mkdirSync(path.join(root, '.git'));
    const setup = runCli(['setup', '--mode', 'platform-aware'], root);
    expect(setup.status).toBe(0);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function addStep(...extra) {
    const r = runCli(['result', 'add-step', '--run-id', RUN_ID, '--scenario-id', 'demo', ...extra], root);
    expect(r.status).toBe(0);
  }

  test('a failed step with no --status exits 6 as failed, and the result is written', () => {
    addStep('--step-id', 's1', '--status', 'fail', '--error-message', 'boom');
    const r = runCli(['result', 'finalize', '--run-id', RUN_ID], root);
    expect(r.status).toBe(6);
    const env = onlyEnvelope(r);
    expect(env.ok).toBe(false);
    expect(env.error.kind).toBe('test_failed');
    expect(env.data.status).toBe('failed');
    expect(fs.existsSync(path.join(root, '.mobile-automator', 'results', `${RUN_ID}.json`))).toBe(true);
  });

  test('an errored step with no --status exits 6 as error', () => {
    addStep('--step-id', 's1', '--status', 'error');
    const r = runCli(['result', 'finalize', '--run-id', RUN_ID], root);
    expect(r.status).toBe(6);
    expect(onlyEnvelope(r).data.status).toBe('error');
  });

  test('all steps passed with no --status exits 0', () => {
    addStep('--step-id', 's1', '--status', 'pass');
    addStep('--step-id', 's2', '--status', 'pass');
    const r = runCli(['result', 'finalize', '--run-id', RUN_ID], root);
    expect(r.status).toBe(0);
    expect(onlyEnvelope(r).data.status).toBe('passed');
  });

  // B1 (#275 review): this used to assert the opposite, that an explicit
  // `--status passed` overrode a recorded failed step. An agent may make a run
  // worse than derived, never greener.
  test('an explicit --status passed over a recorded failed step is refused, nothing written', () => {
    addStep('--step-id', 's1', '--status', 'fail');
    const r = runCli(['result', 'finalize', '--run-id', RUN_ID, '--status', 'passed'], root);
    expect(r.status).toBe(3);
    const env = onlyEnvelope(r);
    expect(env.error.kind).toBe('invalid_input');
    expect(env.hint).toContain('failed');
    // Only the in-progress file add-step wrote; no finalized status.
    const written = JSON.parse(fs.readFileSync(path.join(root, '.mobile-automator', 'results', `${RUN_ID}.json`), 'utf8'));
    expect(written._in_progress).toBe(true);
  });

  test('a step that passed after retries still exits 0', () => {
    addStep('--step-id', 's1', '--status', 'pass', '--attempts', '3');
    const r = runCli(['result', 'finalize', '--run-id', RUN_ID], root);
    expect(r.status).toBe(0);
    expect(onlyEnvelope(r).data.status).toBe('passed');
  });

  test('run-history records the derived failure as F', () => {
    addStep('--step-id', 's1', '--status', 'fail');
    expect(runCli(['result', 'finalize', '--run-id', RUN_ID], root).status).toBe(6);
    const show = runCli(['memory', 'show'], root);
    expect(show.status).toBe(0);
    expect(show.stdout).toMatch(/## demo {2}\(last 5 runs: F\)/);
  });
});
