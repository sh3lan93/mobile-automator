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
    const r = runCli(['result', 'finalize', '--run-id', RUN_ID, '--scenario-id', 'y', '--status', 'passed'], root);
    expect(r.status).toBe(0);
    const env = onlyEnvelope(r);
    expect(env.ok).toBe(true);
    expect(env.data.status).toBe('passed');
  });
});
