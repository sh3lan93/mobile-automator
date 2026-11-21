'use strict';

// The #348 exit criterion, through the REAL bin: a committed opt-in alone
// spools and sends nothing.
//
// The repository supplies everything it can: `telemetry.enabled: true` in the
// committed config, a queued spool of valid lines, and a consent-shaped record
// inside the workspace. What it cannot supply is this user's own consent
// record, outside the repository, and without it no verb may spool and no
// flush may upload or even claim the queue.
//
// Spawned rather than in-process because the decision is taken by run() and
// finish() in a fresh process, where the per-process memo starts empty. A
// control arm grants the consent the repository could not, and shows the same
// harness does see spooling and claiming, so the assertions above it can fail.

const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const spool = require('../../src/observe/spool');
const { setLocalConsent, consentPath } = require('../../src/observe/consent');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'bin', 'mauto.js');

// A fresh, empty per-user config dir; a token that cannot authenticate; a host
// on the discard port, so even a regression could not reach a real endpoint.
function childEnv(xdg) {
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: xdg,
    MAUTO_TELEMETRY_TOKEN: 'phc_test_not_real',
    MAUTO_TELEMETRY_HOST: 'http://127.0.0.1:9',
  };
  for (const k of ['MAUTO_LOG_DIR', 'MAUTO_TELEMETRY', 'DO_NOT_TRACK', 'MAUTO_RUN_ID']) delete env[k];
  return env;
}

function runCli(args, cwd, env) {
  const res = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env, timeout: 30000 });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

const envelopeOf = (r) => JSON.parse(r.stdout.trim().split('\n').pop());

// A cloned repository whose committed workspace opts in and ships a queue.
function clonedRepo() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-consent-')));
  fs.mkdirSync(path.join(root, '.git')); // discovery stops here
  const ws = path.join(root, '.mobile-automator');
  fs.mkdirSync(path.join(ws, '.logs'), { recursive: true });
  fs.writeFileSync(
    path.join(ws, 'config.json'),
    JSON.stringify({ mode: 'platform-aware', telemetry: { enabled: true } }, null, 2)
  );
  // Real spool lines, written by the real writer, so they are what a flush
  // would upload if consent existed (asserted below, not assumed).
  for (let i = 0; i < 2; i++) {
    spool.write({ level: 'info', src: 'cli', event: 'verb.end', verb: 'tap', ok: true }, { projectRoot: root, env: {} });
  }
  // A consent-shaped record the repository plants inside the workspace.
  fs.mkdirSync(path.join(ws, '.session'), { recursive: true });
  fs.writeFileSync(
    path.join(ws, '.session', 'telemetry-consent.json'),
    JSON.stringify({ projects: { [root]: true } }, null, 2)
  );
  return root;
}

const spoolFile = (root) => path.join(root, '.mobile-automator', '.logs', 'telemetry.spool');
const telemetryFiles = (root) =>
  fs
    .readdirSync(path.join(root, '.mobile-automator', '.logs'))
    .filter((n) => n.startsWith('telemetry.spool'))
    .sort();

describe('a committed opt-in alone spools and sends nothing (#348, spawned)', () => {
  let root;
  let xdg;
  let env;
  let planted;

  beforeEach(() => {
    root = clonedRepo();
    xdg = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-consent-xdg-'));
    env = childEnv(xdg);
    planted = fs.readFileSync(spoolFile(root));
    // The planted queue is shippable: these are lines flush would upload.
    expect(spool.readBatch(spoolFile(root), { projectRoot: root, env: {} })).toHaveLength(2);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(xdg, { recursive: true, force: true });
  });

  it('status reports off, not_consented_locally', () => {
    const r = runCli(['telemetry', 'status'], root, env);
    expect(r.status).toBe(0);
    expect(envelopeOf(r)).toMatchObject({ ok: true, data: { enabled: false, reason: 'not_consented_locally' } });
  });

  it('a verb that records telemetry appends nothing to the planted spool', () => {
    const r = runCli(['config', 'get', 'mode'], root, env);
    expect(r.status).toBe(0);
    expect(envelopeOf(r)).toMatchObject({ ok: true, data: { key: 'mode', value: 'platform-aware' } });
    expect(fs.readFileSync(spoolFile(root)).equals(planted)).toBe(true);
    expect(telemetryFiles(root)).toEqual(['telemetry.spool']);
  });

  it('flush is skipped: nothing sent, the planted spool neither changed nor claimed', () => {
    const r = runCli(['telemetry', 'flush'], root, env);
    expect(r.status).toBe(0);
    expect(envelopeOf(r)).toMatchObject({ ok: true, data: { skipped: 'not_consented_locally', sent: 0 } });
    expect(fs.readFileSync(spoolFile(root)).equals(planted)).toBe(true);
    expect(telemetryFiles(root)).toEqual(['telemetry.spool']);
    // And the run wrote no consent anywhere on this user's behalf.
    expect(fs.existsSync(consentPath({ env: { XDG_CONFIG_HOME: xdg } }))).toBe(false);
  });

  // Control arm: the consent the repository cannot write, granted the way
  // `mauto telemetry enable` grants it. The same harness now sees a spooled
  // line and a claimed queue, so the assertions above are able to fail.
  it('control: with this user\'s consent, the same verbs do spool and claim', () => {
    setLocalConsent(root, true, { env: { XDG_CONFIG_HOME: xdg } });

    expect(envelopeOf(runCli(['telemetry', 'status'], root, env)).data).toMatchObject({ enabled: true, reason: 'enabled' });

    const before = fs.statSync(spoolFile(root)).size;
    expect(runCli(['config', 'get', 'mode'], root, env).status).toBe(0);
    expect(fs.statSync(spoolFile(root)).size).toBeGreaterThan(before);

    // The discard port refuses the upload, so the claimed batch is kept.
    const r = runCli(['telemetry', 'flush'], root, env);
    expect(r.status).toBe(0);
    expect(envelopeOf(r).data.skipped).toBeUndefined();
    expect(telemetryFiles(root).some((n) => n.includes('.sending.'))).toBe(true);
  });
});
