'use strict';

// Behavioural guard for the CLI's instrumentation: does an invocation actually
// leave a trace?
//
// This replaces a structural guard that grepped cli.js's source text for
// `record(` inside two named functions. That guard was blind in the exact place
// it mattered — the CLI has THREE process-ending paths and it asserted about
// two, so a parse failure (the whole #146 error class) recorded nothing and no
// test noticed. It also pinned incidental implementation details, so improving
// the code broke the test.
//
// The property under test is per verb CLASS, because each class exits through
// a different path: envelope verbs, raw verbs (guide/schema/bootstrap), and
// parse failures that never reach an action at all.
//
// Harness is the one tests/integration/stdout-purity.test.js already proves:
// spawn the real bin, read what it wrote.

const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'bin', 'mauto.js');

function runCli(args, env = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-observe-cli-'));
  const logDir = path.join(cwd, 'logs');
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    // MAUTO_LOG_DIR is the explicit relocation override, so the log lands in a
    // directory this test owns rather than depending on a workspace existing.
    env: { ...process.env, MAUTO_LOG_DIR: logDir, MAUTO_LOG_LEVEL: 'info', ...env },
  });
  const logFile = path.join(logDir, 'mauto.ndjson');
  const events = fs.existsSync(logFile)
    ? fs
        .readFileSync(logFile, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
  return { status: res.status, stdout: res.stdout || '', events };
}

const verbEnds = (run) => run.events.filter((e) => e.event === 'verb.end');

describe('cli observability (integration)', () => {
  it('records a verb.end for an envelope verb', () => {
    const run = runCli(['config', 'get', 'mode']);
    const [event, ...rest] = verbEnds(run);
    expect(rest).toEqual([]);
    expect(event).toMatchObject({ src: 'cli', verb: 'config', ok: true, exit_code: 0 });
    expect(typeof event.dur_ms).toBe('number');
    expect(event.dur_ms).toBeGreaterThan(0);
  });

  it('records a verb.end for a raw verb, which builds no envelope', () => {
    const run = runCli(['guide', 'setup']);
    const [event, ...rest] = verbEnds(run);
    expect(rest).toEqual([]);
    expect(event).toMatchObject({ src: 'cli', verb: 'guide', ok: true, exit_code: 0 });
  });

  it('records a verb.end for a parse failure, which reaches no action at all', () => {
    const run = runCli(['--nope']);
    expect(run.status).toBe(3);
    const [event, ...rest] = verbEnds(run);
    expect(rest).toEqual([]);
    // `info`, not `warn`: the failure is carried by `ok` and `error_kind`. The
    // level only decides routing, and recording failures at `warn` would clear
    // the default stderr threshold and echo every failed verb — restating the
    // envelope the CLI just wrote. The file sink records it either way.
    expect(event).toMatchObject({ src: 'cli', ok: false, exit_code: 3, level: 'info' });
  });

  it('omits verb entirely on a parse failure rather than inventing one', () => {
    // A parse failure HAS no verb. Omitting the field is the honest record;
    // guessing at argv is what put a `--human` in the log.
    const run = runCli(['--nope']);
    expect(verbEnds(run)[0]).not.toHaveProperty('verb');
  });

  // Commander writes help/version text and terminates DURING the parse, before
  // any action exists to wrap. That is a fourth exit path, and it stayed
  // uninstrumented through a full review-and-fix round. Slice 5 ships aggregate
  // counts off this stream, so an invocation class that emits nothing skews the
  // denominator of every rate computed from it.
  describe('help and version terminate during the parse, and are still recorded', () => {
    it('records a verb.end for --help', () => {
      const run = runCli(['--help']);
      expect(run.status).toBe(0);
      const [event, ...rest] = verbEnds(run);
      expect(rest).toEqual([]);
      expect(event).toMatchObject({ src: 'cli', ok: true, exit_code: 0 });
    });

    it('omits verb on --help rather than inventing one', () => {
      // preAction fires only after a successful parse resolves a command;
      // commander displays help INSIDE the parse, so no command was resolved.
      // Absent is the honest record, exactly as for a parse failure.
      expect(verbEnds(runCli(['--help']))[0]).not.toHaveProperty('verb');
    });

    it('records a verb.end for --version', () => {
      const run = runCli(['--version']);
      expect(run.status).toBe(0);
      expect(verbEnds(run)[0]).toMatchObject({ src: 'cli', ok: true, exit_code: 0 });
    });

    it('records a verb.end for a subcommand help', () => {
      const run = runCli(['tap', '--help']);
      expect(run.status).toBe(0);
      expect(verbEnds(run)).toHaveLength(1);
    });

    it('leaves the help text on stdout untouched, adding no blank line', () => {
      // Commander already wrote the text. Recording the invocation must not
      // also make finish() write an empty line after it.
      const run = runCli(['--help']);
      expect(run.stdout).toContain('Usage: mauto');
      expect(run.stdout.endsWith('\n\n')).toBe(false);
    });
  });

  it('records the error kind when an envelope verb fails', () => {
    const run = runCli(['validate', 'no-such-file.json']);
    const event = verbEnds(run)[0];
    expect(event).toMatchObject({ verb: 'validate', ok: false, level: 'info' });
    expect(typeof event.error_kind).toBe('string');
  });

  describe('verb is a name from the shipped command vocabulary, never an argv token', () => {
    // event.js justifies `verb: sends: true` as "a fixed vocabulary we ship".
    // Slice 5 will ship this field to a third party on that justification, so
    // the field has to actually BE that — an argv token is arbitrary user text.

    it('skips a leading global option', () => {
      expect(verbEnds(runCli(['--human', 'config', 'get', 'mode']))[0].verb).toBe('config');
    });

    it('names the top-level command, not the nested subcommand', () => {
      expect(verbEnds(runCli(['config', 'get', 'mode']))[0].verb).toBe('config');
    });

    it('never records a token that is merely an option value', () => {
      // `--kind` takes a value that happens to spell a real verb name. A scan
      // for "the first argv token that looks like a verb" records `setup`.
      const event = verbEnds(runCli(['memory', 'add', 'hello', '--kind', 'setup']))[0];
      expect(event.verb).toBe('memory');
    });
  });
});
