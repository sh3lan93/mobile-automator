'use strict';

// Upward workspace discovery through the REAL bin (#188).
//
// Spawned rather than in-process because the defect lived in run() — the only
// production caller of buildProgram() — which passed no root at all. An
// in-process test that injects a root can never see that.
//
// Every fixture has a `.git` at its project root so discovery stops there and
// cannot wander into whatever sits above os.tmpdir() on the test machine.
// Roots go through realpathSync: macOS's /tmp is a symlink to /private/tmp and
// the child's process.cwd() reports the physical path, which is what the
// no-workspace hint names.

const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'bin', 'mauto.js');

// Log settings are pinned so the file-sink assertion does not depend on the
// ambient environment: MAUTO_LOG_DIR would relocate the log out of the
// workspace, which is the very thing under test.
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

const envelopeOf = (r) => JSON.parse(r.stdout.trim().split('\n').pop());

function tmpProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-discovery-')));
  fs.mkdirSync(path.join(root, '.git'));
  return root;
}

describe('workspace discovery (integration, #188)', () => {
  let root;

  beforeEach(() => {
    root = tmpProject();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe('with a workspace at the project root', () => {
    let nested;

    beforeEach(() => {
      const setup = runCli(['setup', '--mode', 'platform-aware'], root);
      expect(setup.status).toBe(0);
      nested = path.join(root, 'src', 'deep', 'nested');
      fs.mkdirSync(nested, { recursive: true });
    });

    test('config get from a subdirectory returns the root workspace value', () => {
      const r = runCli(['config', 'get', 'mode'], nested);
      expect(r.status).toBe(0);
      expect(envelopeOf(r)).toMatchObject({ ok: true, data: { key: 'mode', value: 'platform-aware' } });
    });

    test('config set from a subdirectory writes the root config, not a new one in cwd', () => {
      const r = runCli(['config', 'set', 'app_id', 'com.acme.app'], nested);
      expect(r.status).toBe(0);
      const cfg = JSON.parse(fs.readFileSync(path.join(root, 'mobile-automator', 'config.json'), 'utf8'));
      expect(cfg.app_id).toBe('com.acme.app');
      expect(fs.existsSync(path.join(nested, 'mobile-automator'))).toBe(false);
    });

    test('memory add from a subdirectory lands in the root store, and memory show there sees it', () => {
      const add = runCli(['memory', 'add', 'login needs a 2s settle', '--kind', 'app-knowledge'], nested);
      expect(add.status).toBe(0);
      expect(envelopeOf(add).ok).toBe(true);
      expect(fs.existsSync(path.join(nested, 'mobile-automator'))).toBe(false);

      const show = runCli(['memory', 'show', '--kind', 'app-knowledge'], nested);
      expect(show.status).toBe(0);
      expect(show.stdout).toContain('login needs a 2s settle');
    });

    test('works from inside mobile-automator/scenarios/', () => {
      const scenarios = path.join(root, 'mobile-automator', 'scenarios');
      fs.mkdirSync(scenarios, { recursive: true });
      const r = runCli(['config', 'get', 'mode'], scenarios);
      expect(envelopeOf(r).data.value).toBe('platform-aware');
      expect(fs.existsSync(path.join(scenarios, 'mobile-automator'))).toBe(false);
    });

    test('result add-step from a subdirectory writes into the root workspace', () => {
      const r = runCli(
        ['result', 'add-step', '--run-id', 'run_20260928_120000', '--step-id', 's1', '--status', 'pass'],
        nested
      );
      expect(r.status).toBe(0);
      expect(fs.existsSync(path.join(root, 'mobile-automator', 'results'))).toBe(true);
      expect(fs.readdirSync(path.join(root, 'mobile-automator', 'results')).length).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(nested, 'mobile-automator'))).toBe(false);
    });

    test('the verb.end record lands in the discovered workspace .logs/', () => {
      runCli(['config', 'get', 'mode'], nested);
      const logFile = path.join(root, 'mobile-automator', '.logs', 'mauto.ndjson');
      expect(fs.existsSync(logFile)).toBe(true);
      const events = fs
        .readFileSync(logFile, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      expect(events).toContainEqual(expect.objectContaining({ event: 'verb.end', verb: 'config', ok: true }));
    });

    test('setup from a subdirectory creates a nested workspace in cwd and names the ancestor', () => {
      const r = runCli(['setup'], nested);
      expect(r.status).toBe(0);
      const env = envelopeOf(r);
      expect(env.ok).toBe(true);
      expect(env.hint).toContain(root);
      expect(fs.existsSync(path.join(nested, 'mobile-automator', 'config.json'))).toBe(true);
    });

    // telemetry status/enable/disable/flush are requireWorkspace-gated on the
    // same grounds as config get/set: they read or write the root workspace's
    // config.json (status/enable/disable) or its .logs/telemetry.spool
    // (flush), and none of that belongs in a phantom cwd-relative workspace.
    test('telemetry status from a subdirectory reports the root workspace', () => {
      const r = runCli(['telemetry', 'status'], nested);
      expect(r.status).toBe(0);
      expect(envelopeOf(r)).toMatchObject({ ok: true, data: { enabled: false, reason: 'not_configured' } });
    });

    test('telemetry enable from a subdirectory writes the root config, not a new one in cwd', () => {
      const r = runCli(['telemetry', 'enable'], nested);
      expect(r.status).toBe(0);
      const cfg = JSON.parse(fs.readFileSync(path.join(root, 'mobile-automator', 'config.json'), 'utf8'));
      expect(cfg.telemetry.enabled).toBe(true);
      expect(fs.existsSync(path.join(nested, 'mobile-automator'))).toBe(false);
    });
  });

  describe('with no workspace anywhere up to the .git boundary', () => {
    let sub;

    beforeEach(() => {
      sub = path.join(root, 'app');
      fs.mkdirSync(sub);
    });

    const expectNoWorkspace = (r) => {
      expect(r.status).toBe(5);
      const env = envelopeOf(r);
      expect(env.ok).toBe(false);
      expect(env.error.kind).toBe('environment');
      expect(env.hint).toContain(sub);
      expect(env.hint).toContain(root);
      expect(env.hint).toMatch(/mauto setup/);
    };

    test('config get fails honestly instead of ok:true with a missing value', () => {
      expectNoWorkspace(runCli(['config', 'get', 'mode'], sub));
    });

    test('config set fails and creates no mobile-automator/', () => {
      expectNoWorkspace(runCli(['config', 'set', 'app_id', 'com.acme.app'], sub));
      expect(fs.existsSync(path.join(sub, 'mobile-automator'))).toBe(false);
    });

    test('memory show fails instead of reporting an empty store', () => {
      expectNoWorkspace(runCli(['memory', 'show'], sub));
    });

    test('memory add fails and writes nothing', () => {
      expectNoWorkspace(runCli(['memory', 'add', 'x', '--kind', 'preferences'], sub));
      expect(fs.existsSync(path.join(sub, 'mobile-automator'))).toBe(false);
    });

    test('result add-step fails and writes nothing', () => {
      expectNoWorkspace(
        runCli(['result', 'add-step', '--run-id', 'run_20260928_120000', '--step-id', 's1', '--status', 'pass'], sub)
      );
      expect(fs.existsSync(path.join(sub, 'mobile-automator'))).toBe(false);
    });

    test('result finalize fails', () => {
      expectNoWorkspace(runCli(['result', 'finalize', '--run-id', 'run_20260928_120000'], sub));
    });

    test('telemetry status fails instead of reporting not_configured for the wrong reason', () => {
      expectNoWorkspace(runCli(['telemetry', 'status'], sub));
    });

    test('telemetry enable fails and creates no mobile-automator/', () => {
      expectNoWorkspace(runCli(['telemetry', 'enable'], sub));
      expect(fs.existsSync(path.join(sub, 'mobile-automator'))).toBe(false);
    });

    // The two device verbs whose whole job is persisting workspace state
    // (the daemon handle, the device selection — both under
    // mobile-automator/.session/) join the gated set: ok:true plus a phantom
    // workspace tree is the exact #188 pathology.
    test('session start fails and creates no mobile-automator/', () => {
      expectNoWorkspace(runCli(['session', 'start'], sub));
      expect(fs.existsSync(path.join(sub, 'mobile-automator'))).toBe(false);
    });

    test('devices use fails and creates no mobile-automator/', () => {
      expectNoWorkspace(runCli(['devices', 'use', 'emulator-5554'], sub));
      expect(fs.existsSync(path.join(sub, 'mobile-automator'))).toBe(false);
    });

    // Read-only device use stays zero-config, but the daemon must not
    // autostart into a workspace-less cwd: the verb connects one-shot and
    // leaves nothing behind.
    test('devices stays tolerant but spawns no daemon and creates no mobile-automator/', () => {
      const r = runCli(['devices'], sub);
      expect(r.status).toBe(0);
      expect(envelopeOf(r).ok).toBe(true);
      expect(Array.isArray(envelopeOf(r).data)).toBe(true);
      expect(fs.existsSync(path.join(sub, 'mobile-automator'))).toBe(false);
    });

    test('guide stays tolerant: raw content, exit 0', () => {
      const r = runCli(['guide', 'execute'], sub);
      expect(r.status).toBe(0);
      expect(r.stdout.length).toBeGreaterThan(0);
    });

    test('setup still scaffolds in cwd', () => {
      const r = runCli(['setup'], sub);
      expect(r.status).toBe(0);
      expect(envelopeOf(r).hint).toBeUndefined();
      expect(fs.existsSync(path.join(sub, 'mobile-automator', 'config.json'))).toBe(true);
    });
  });
});
