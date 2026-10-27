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
const FAILED_RESULT = require('../unit/run/report/fixtures/failed.json');
const { parseXml, findAll } = require('../helpers/parse-xml');

// Run the CLI as a child process. Returns { status, stdout, stderr }.
function runCli(args, opts = {}) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd: opts.cwd || REPO_ROOT,
    encoding: 'utf8',
    env: opts.env || process.env,
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

// Create a fresh temp workspace (a directory that will hold .mobile-automator/).
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
    const configDir = path.join(workspace, '.mobile-automator');
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

  test('validate warns on an unsupported action; --strict turns it into a failure (#166)', () => {
    const file = path.join(workspace, 'clear-data.json');
    fs.writeFileSync(file, JSON.stringify({
      $schema_version: '2.1',
      scenario_id: 'clear_data_probe',
      name: 'Clear data probe',
      description: 'probe',
      platform: 'android',
      app_package: 'com.example.app',
      metadata: { app_version: '1.0.0', environment: 'staging' },
      steps: [{ id: 's1', action: 'clear_app_data', target_package: 'com.example.app', description: 'Clear app data' }],
      assertions: [],
    }));

    const warn = runCli(['validate', file]);
    expect(warn.status).toBe(0);
    const w = JSON.parse(warn.stdout);
    expect(w.ok).toBe(true);
    expect(w.data.warnings[0]).toMatchObject({ code: 'unsupported_action', path: 'steps[0]', step_id: 's1' });
    expect(w.hint).toBe('1 action(s) cannot replay unattended — see data.warnings');

    const strict = runCli(['validate', file, '--strict']);
    expect(strict.status).toBe(3); // EXIT.INVALID_INPUT
    const s = JSON.parse(strict.stdout);
    expect(s.ok).toBe(false);
    expect(s.data.warnings).toHaveLength(1);
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

  // #144: a workspace initialised by a pre-0.21 `mauto init --agent claude`
  // (one-line command files, no skills) is flagged by guide and doctor, and a
  // re-run of init clears both.
  test('stale pre-0.21 claude integration: guide notice + doctor, cleared by init', () => {
    for (const topic of ['generate', 'execute', 'setup']) {
      const f = path.join(workspace, '.claude', 'commands', `mobile-automator-${topic}.md`);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(
        f,
        `Run \`mauto guide ${topic}\` and follow it. Drive the device only through \`mauto\` verbs (never assume resource-ids).\n`
      );
    }
    fs.writeFileSync(
      path.join(workspace, '.mcp.json'),
      JSON.stringify({ mcpServers: { mauto: { command: 'mauto', args: ['mcp'] } } }, null, 2) + '\n'
    );

    const staleGuide = runCli(['guide', 'execute'], { cwd: workspace });
    expect(staleGuide.status).toBe(0);
    expect(staleGuide.stdout.startsWith('> **Notice')).toBe(true);
    expect(staleGuide.stdout).toContain('`mauto init --agent claude`');

    const staleDoctor = runCli(['doctor'], { cwd: workspace });
    expect(staleDoctor.status).toBe(0);
    const before = JSON.parse(staleDoctor.stdout);
    expect(before.ok).toBe(true);
    expect(before.data.initialised).toBe(true);
    expect(before.data.stale).toEqual(['claude']);
    expect(before.hint).toBe('run `mauto init --agent claude`');

    const init = runCli(['init', '--agent', 'claude'], { cwd: workspace });
    expect(init.status).toBe(0);
    expect(JSON.parse(init.stdout).ok).toBe(true);

    const freshGuide = runCli(['guide', 'execute'], { cwd: workspace });
    expect(freshGuide.status).toBe(0);
    expect(freshGuide.stdout).not.toContain('**Notice');

    const after = JSON.parse(runCli(['doctor'], { cwd: workspace }).stdout);
    expect(after.ok).toBe(true);
    expect(after.data.stale).toEqual([]);
    expect(after.hint).toBeUndefined();
  });

  test('doctor in an empty dir is ok and points at init', () => {
    const r = runCli(['doctor'], { cwd: workspace });
    expect(r.status).toBe(0);
    const env = JSON.parse(r.stdout);
    expect(env.data).toEqual({ initialised: false, hosts: [], stale: [] });
    expect(env.hint).toMatch(/mauto init --agent <host>/);
  });

  test('config get mode reads the workspace config value', () => {
    // Hand-write a workspace config (mirrors what `mauto setup` produces).
    const configDir = path.join(workspace, '.mobile-automator');
    fs.mkdirSync(configDir, { recursive: true });
    fs.copyFileSync(CONFIG_FIXTURE, path.join(configDir, 'config.json'));

    const r = runCli(['config', 'get', 'mode'], { cwd: workspace });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.key).toBe('mode');
    expect(parsed.data.value).toBe('platform-aware');
  });

  // #251: an engine switch clears the persisted device selection (ids differ
  // between engines) and says so in the envelope. Device-free.
  test('config set engine legacy clears the device selection and explains why', () => {
    const configDir = path.join(workspace, '.mobile-automator');
    fs.mkdirSync(path.join(configDir, '.session'), { recursive: true });
    fs.copyFileSync(CONFIG_FIXTURE, path.join(configDir, 'config.json'));
    const selection = path.join(configDir, '.session', 'selection.json');
    fs.writeFileSync(selection, JSON.stringify({ device: 'Pixel_9_Pro' }));
    const env = { ...process.env };
    delete env.MOBILEMCP_LEGACY_ROBOT;

    const r = runCli(['config', 'set', 'engine', 'legacy'], { cwd: workspace, env });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data).toEqual({
      key: 'engine',
      value: 'legacy',
      previous: 'mobilecli',
      device_selection_cleared: true,
    });
    expect(parsed.hint).toContain('`mauto devices use <id>`');
    expect(fs.existsSync(selection)).toBe(false);

    const again = JSON.parse(runCli(['config', 'set', 'engine', 'legacy'], { cwd: workspace, env }).stdout);
    expect(again).toEqual({ ok: true, data: { key: 'engine', value: 'legacy' }, schema_version: parsed.schema_version });
  });

  // #274: JUnit export of a pre-written result file, through the real binary.
  describe('result export --format junit', () => {
    function writeWorkspaceResult() {
      const configDir = path.join(workspace, '.mobile-automator');
      fs.mkdirSync(path.join(configDir, 'results'), { recursive: true });
      fs.copyFileSync(CONFIG_FIXTURE, path.join(configDir, 'config.json'));
      fs.writeFileSync(
        path.join(configDir, 'results', `${FAILED_RESULT.run_id}.json`),
        JSON.stringify(FAILED_RESULT, null, 2)
      );
    }

    test('returns well-formed XML in data.xml and exits 0 even though the run failed', () => {
      writeWorkspaceResult();
      const r = runCli(['result', 'export', '--run-id', FAILED_RESULT.run_id, '--format', 'junit'], { cwd: workspace });
      expect(r.status).toBe(0);
      const env = JSON.parse(r.stdout);
      expect(env.ok).toBe(true);
      expect(env.data).toMatchObject({ format: 'junit', path: null, suites: 1, tests: 4, failures: 3, skipped: 0 });
      const [suite] = findAll(parseXml(env.data.xml), 'testsuite');
      expect(suite.attrs.name).toBe(FAILED_RESULT.scenario_id);
    });

    test('--out writes a parseable report file', () => {
      writeWorkspaceResult();
      const r = runCli(
        ['result', 'export', '--run-id', FAILED_RESULT.run_id, '--format', 'junit', '--out', 'reports/junit.xml'],
        { cwd: workspace }
      );
      expect(r.status).toBe(0);
      const env = JSON.parse(r.stdout);
      expect(env.data.xml).toBeUndefined();
      expect(fs.realpathSync(env.data.path)).toBe(fs.realpathSync(path.join(workspace, 'reports', 'junit.xml')));
      expect(parseXml(fs.readFileSync(env.data.path, 'utf8')).name).toBe('testsuites');
    });

    test('an unknown format is an invalid_input envelope', () => {
      writeWorkspaceResult();
      const r = runCli(['result', 'export', '--run-id', FAILED_RESULT.run_id, '--format', 'sarif'], { cwd: workspace });
      expect(r.status).toBe(3); // EXIT.INVALID_INPUT
      const env = JSON.parse(r.stdout);
      expect(env.ok).toBe(false);
      expect(env.error.kind).toBe('invalid_input');
      expect(env.hint).toMatch(/junit/);
    });
  });
});
