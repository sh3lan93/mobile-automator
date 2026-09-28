'use strict';

// THE guard for the locked envelope invariant. Logging must never contaminate
// stdout, which the calling agent parses. Split by verb class because the two
// classes have genuinely different stdout contracts:
//   - envelope verbs emit exactly one JSON object
//   - raw verbs (guide/schema/bootstrap) emit markdown/JSON with NO envelope
// Both must hold at EVERY log level, which is what catches a stray sink write.

const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { TOKEN_PLACEHOLDER } = require('../../src/observe/transport');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'bin', 'mauto.js');

function runCli(args, env = {}) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-purity-'));
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ws,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

// A workspace-provisioned variant, for a verb wrapped in requireWorkspace
// (#188) — config get/set and, since this session, all four telemetry verbs.
// Without a real mobile-automator/config.json in cwd, those now fail
// `environment` (exit 5) before reaching the code path this suite means to
// exercise; the failure envelope still satisfies a loose "one JSON object"
// assertion, which is exactly how this gap stayed invisible. Reuses the same
// temp dir runCli() would have made, so cwd for the real invocation matches.
function runCliWithWorkspace(args, env = {}) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-purity-'));
  const setup = spawnSync(process.execPath, [CLI, 'setup', '--mode', 'aware'], { cwd: ws, encoding: 'utf8' });
  if (setup.status !== 0) throw new Error(`workspace setup failed: ${setup.stdout}${setup.stderr}`);
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ws,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

const LEVELS = ['silent', 'error', 'warn', 'info', 'debug'];

describe('stdout purity (integration)', () => {
  describe.each(LEVELS)('at MAUTO_LOG_LEVEL=%s', (level) => {
    it('an envelope verb emits exactly one JSON object on stdout', () => {
      const { stdout } = runCliWithWorkspace(['config', 'get', 'mode'], { MAUTO_LOG_LEVEL: level });
      const lines = stdout.trim().split('\n').filter(Boolean);
      expect(lines).toHaveLength(1);
      expect(() => JSON.parse(lines[0])).not.toThrow();
      const envelope = JSON.parse(lines[0]);
      expect(envelope).toHaveProperty('schema_version');
      // A loose "one JSON object" check alone would also pass for the
      // requireWorkspace failure envelope (#188) — exercise the actual
      // success path this test means to cover, not just its shape.
      expect(envelope).toMatchObject({ ok: true, data: { key: 'mode', value: 'platform-aware' } });
    });

    it('a raw verb emits markdown identical to the silent baseline', () => {
      const baseline = runCli(['guide', 'setup'], { MAUTO_LOG_LEVEL: 'silent' }).stdout;
      const got = runCli(['guide', 'setup'], { MAUTO_LOG_LEVEL: level }).stdout;
      expect(got).toBe(baseline);
    });

    it('a parse error still emits exactly one JSON object on stdout', () => {
      const { stdout } = runCli(['--nope'], { MAUTO_LOG_LEVEL: level });
      const lines = stdout.trim().split('\n').filter(Boolean);
      expect(lines).toHaveLength(1);
      expect(() => JSON.parse(lines[0])).not.toThrow();
    });
  });

  it('emits diagnostics on stderr when the level asks for them', () => {
    const { stderr } = runCliWithWorkspace(['config', 'get', 'mode'], { MAUTO_LOG_LEVEL: 'debug' });
    expect(stderr).toContain('verb.end');
  });
});

describe('telemetry verbs (integration)', () => {
  // `flush` is the ONE verb permitted a network round trip, and it is run
  // here with a kill switch set so the suite never reaches the wire while
  // still exercising the path (a provisioned-but-unconfigured workspace
  // already resolves telemetry not_configured regardless, so this is
  // belt-and-braces, not the only thing stopping a real POST). All four
  // verbs are requireWorkspace-gated (#188), so this needs a real workspace
  // — a loose "one JSON object" check alone would also pass for the
  // requireWorkspace failure envelope and silently stop testing what it
  // claims to.
  function assertsSingleEnvelope(args, env) {
    const { stdout } = runCliWithWorkspace(args, env);
    const lines = stdout.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(() => JSON.parse(lines[0])).not.toThrow();
    const envelope = JSON.parse(lines[0]);
    expect(envelope).toHaveProperty('schema_version');
    expect(envelope.ok).toBe(true);
    return envelope;
  }

  it('status emits exactly one JSON object on stdout', () => {
    const envelope = assertsSingleEnvelope(['telemetry', 'status']);
    expect(envelope.data).toMatchObject({ enabled: false, reason: 'not_configured' });
  });

  it('enable emits exactly one JSON object on stdout', () => {
    // No override needed: a real project token ships (Task 12 graduation),
    // so enabling now genuinely resolves usable out of the box.
    const envelope = assertsSingleEnvelope(['telemetry', 'enable']);
    expect(envelope.data).toMatchObject({ enabled: true, reason: 'enabled' });
  });

  it('enable still resolves no_token when the configured token is explicitly the placeholder', () => {
    const envelope = assertsSingleEnvelope(['telemetry', 'enable'], { MAUTO_TELEMETRY_TOKEN: TOKEN_PLACEHOLDER });
    expect(envelope.data.reason).toBe('no_token');
  });

  it('disable emits exactly one JSON object on stdout', () => {
    const envelope = assertsSingleEnvelope(['telemetry', 'disable']);
    expect(envelope.data).toMatchObject({ enabled: false });
  });

  it('flush emits exactly one JSON object on stdout, never reaching the wire', () => {
    const envelope = assertsSingleEnvelope(['telemetry', 'flush'], { MAUTO_TELEMETRY: '0' });
    expect(envelope.data).toMatchObject({ skipped: 'kill_switch', sent: 0 });
  });
});
