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

  test('-V exits 0 and prints a semver', () => {
    const r = runCli(['-V']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  // Regression: version handling used to be a hand-rolled argv pre-scan
  // (`argv.some((a) => a === '--version')`) running ahead of commander. That
  // scan is positionally blind — it cannot honor the POSIX `--` separator,
  // which is a parser state transition rather than a matchable token — so it
  // hijacked `--version` even when supplied as an operand. `mauto type --
  // --version` printed the version and exited 0 instead of typing the text,
  // and NO invocation could pass the literal value. Commander's own
  // `.version()` tracks that state, so the escape works again.
  //
  // Asserted via `config set` rather than `type` so the test needs no device.
  test('the POSIX `--` separator protects a leading-dash value from the version flag', () => {
    const configDir = path.join(workspace, 'mobile-automator');
    fs.mkdirSync(configDir, { recursive: true });
    fs.copyFileSync(CONFIG_FIXTURE, path.join(configDir, 'config.json'));

    const set = runCli(['config', 'set', 'build_command', '--', '--version'], { cwd: workspace });
    expect(set.status).toBe(0);
    // The giveaway for the old behavior: bare semver on stdout, exit 0.
    expect(set.stdout.trim()).not.toMatch(/^\d+\.\d+\.\d+$/);

    const get = runCli(['config', 'get', 'build_command'], { cwd: workspace });
    expect(get.status).toBe(0);
    const parsed = JSON.parse(get.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.value).toBe('--version');
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
