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

const LEVELS = ['silent', 'error', 'warn', 'info', 'debug'];

describe('stdout purity (integration)', () => {
  describe.each(LEVELS)('at MAUTO_LOG_LEVEL=%s', (level) => {
    it('an envelope verb emits exactly one JSON object on stdout', () => {
      const { stdout } = runCli(['config', 'get', 'mode'], { MAUTO_LOG_LEVEL: level });
      const lines = stdout.trim().split('\n').filter(Boolean);
      expect(lines).toHaveLength(1);
      expect(() => JSON.parse(lines[0])).not.toThrow();
      expect(JSON.parse(lines[0])).toHaveProperty('schema_version');
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
    const { stderr } = runCli(['config', 'get', 'mode'], { MAUTO_LOG_LEVEL: 'debug' });
    expect(stderr).toContain('verb.end');
  });
});

describe('telemetry verbs (integration)', () => {
  // `flush` is the ONE verb permitted a network round trip, and it is run
  // here with a kill switch set so the suite never reaches the wire while
  // still exercising the path (a fresh, `mauto setup`-less workspace already
  // resolves telemetry not_configured regardless, so this is belt-and-braces,
  // not the only thing stopping a real POST).
  function assertsSingleEnvelope(args, env) {
    const { stdout } = runCli(args, env);
    const lines = stdout.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(() => JSON.parse(lines[0])).not.toThrow();
    expect(JSON.parse(lines[0])).toHaveProperty('schema_version');
  }

  it('status emits exactly one JSON object on stdout', () => {
    assertsSingleEnvelope(['telemetry', 'status']);
  });

  it('enable emits exactly one JSON object on stdout', () => {
    assertsSingleEnvelope(['telemetry', 'enable']);
  });

  it('disable emits exactly one JSON object on stdout', () => {
    assertsSingleEnvelope(['telemetry', 'disable']);
  });

  it('flush emits exactly one JSON object on stdout, never reaching the wire', () => {
    assertsSingleEnvelope(['telemetry', 'flush'], { MAUTO_TELEMETRY: '0' });
  });
});
