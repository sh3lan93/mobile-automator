'use strict';

// Integration smoke suite: spawns the REAL CLI (`node bin/mauto.js`) as a child
// process and asserts stable, no-device behaviors against the JSON envelope
// contract. Each test runs in a fresh temp workspace so no state leaks between
// cases. These deliberately avoid anything that needs a connected device or
// that depends on parse-error handling (a separate lane owns that).

const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Repo root = two levels up from tests/integration/. The CLI path is resolved
// to an absolute path (relative to the repo root) so the child can be spawned
// with cwd set to a temp workspace while the script itself resolves from the
// checkout — a bare relative script path would be looked up against cwd.
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'bin', 'mauto.js');

const VALID_SCENARIO = path.join(__dirname, 'fixtures', 'scenario-valid.json');
const CONFIG_FIXTURE = path.join(REPO_ROOT, 'tests', 'fixtures', 'config.platform-aware.json');

// Run the CLI as a child process. Returns { status, stdout, stderr }.
function runCli(args, opts = {}) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd: opts.cwd || REPO_ROOT,
    encoding: 'utf8',
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

// Create a fresh temp workspace (a directory that will hold mobile-automator/).
function makeWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-smoke-'));
}

describe('cli smoke (integration)', () => {
  let workspace;

  beforeEach(() => {
    workspace = makeWorkspace();
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  test('--version exits 0 and prints a semver', () => {
    const r = runCli(['--version']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('validate on a valid scenario returns an ok:true envelope', () => {
    const r = runCli(['validate', VALID_SCENARIO]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.valid).toBe(true);
  });

  test('schema scenario prints parseable JSON', () => {
    const r = runCli(['schema', 'scenario']);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.type).toBe('object');
  });

  test('guide generate output contains no surviving {{ placeholder }}', () => {
    const r = runCli(['guide', 'generate']);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('{{');
  });

  test('config get mode reads the workspace config value', () => {
    // Hand-write a workspace config (mirrors what `mauto setup` produces).
    const configDir = path.join(workspace, 'mobile-automator');
    fs.mkdirSync(configDir, { recursive: true });
    fs.copyFileSync(CONFIG_FIXTURE, path.join(configDir, 'config.json'));

    const r = runCli(['config', 'get', 'mode'], { cwd: workspace });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.key).toBe('mode');
    expect(parsed.data.value).toBe('platform-aware');
  });
});
