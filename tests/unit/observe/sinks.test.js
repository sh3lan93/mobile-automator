'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const stderrSink = require('../../../src/observe/sinks/stderr');
const fileSink = require('../../../src/observe/sinks/file');
const { MAX_LOG_BYTES } = require('../../../src/device/session-log');

// A project that HAS run `mauto setup`: mobile-automator/ exists, so the file
// sink is allowed to log into it.
function workspace() {
  const root = bareDir();
  fs.mkdirSync(path.join(root, 'mobile-automator'), { recursive: true });
  return root;
}

// A project that has NOT: any directory a user happens to run `mauto` from.
function bareDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-observe-'));
}

describe('stderr sink', () => {
  it('writes a single readable line to the injected stream', () => {
    const written = [];
    stderrSink.write(
      { ts: '2026-09-01T00:00:00.000Z', level: 'warn', event: 'verb.end', verb: 'tap', ok: false },
      { stream: { write: (s) => written.push(s) } }
    );
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/^\[warn\] verb\.end verb=tap ok=false\n$/);
  });

  it('never writes to stdout', () => {
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSink.write({ level: 'error', event: 'x' }, { stream: { write() {} } });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('file sink', () => {
  it('appends one JSON object per line', () => {
    const root = workspace();
    fileSink.write({ level: 'info', event: 'verb.end', verb: 'tap' }, { projectRoot: root, env: {} });
    fileSink.write({ level: 'info', event: 'verb.end', verb: 'swipe' }, { projectRoot: root, env: {} });

    const logPath = path.join(root, 'mobile-automator', '.logs', 'mauto.ndjson');
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).verb).toBe('tap');
    expect(JSON.parse(lines[1]).verb).toBe('swipe');
  });

  it('creates the log directory on demand', () => {
    const root = workspace();
    fileSink.write({ level: 'info', event: 'e' }, { projectRoot: root, env: {} });
    expect(fs.existsSync(path.join(root, 'mobile-automator', '.logs'))).toBe(true);
  });

  it('rotates to .1 at the shared 1 MiB cap, keeping one generation', () => {
    const root = workspace();
    const dir = path.join(root, 'mobile-automator', '.logs');
    const logPath = path.join(dir, 'mauto.ndjson');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(logPath, 'x'.repeat(MAX_LOG_BYTES));

    fileSink.write({ level: 'info', event: 'after-rotate' }, { projectRoot: root, env: {} });

    expect(fs.statSync(`${logPath}.1`).size).toBe(MAX_LOG_BYTES);
    expect(fs.readFileSync(logPath, 'utf8')).toContain('after-rotate');
  });

  // "No workspace, no file log." mauto is a CLI a user runs from any directory;
  // creating mobile-automator/ as a side effect of logging would litter every
  // repo it is invoked in. Worse, it would create the directory WITHOUT the
  // .gitignore that `mauto setup` writes, so a project that never ran setup
  // ends up with an untracked, un-ignored directory holding device serials.
  describe('the workspace gates file logging', () => {
    it('writes nothing when mobile-automator/ does not exist', () => {
      const root = bareDir();
      fileSink.write({ level: 'info', event: 'e' }, { projectRoot: root, env: {} });
      expect(fs.readdirSync(root)).toEqual([]);
    });

    it('does not create the workspace directory itself', () => {
      const root = bareDir();
      fileSink.write({ level: 'info', event: 'e' }, { projectRoot: root, env: {} });
      expect(fs.existsSync(path.join(root, 'mobile-automator'))).toBe(false);
    });

    it('checks the base dir, not .logs/ — a set-up workspace logs on first run', () => {
      const root = workspace(); // mobile-automator/ exists; .logs/ does not yet
      fileSink.write({ level: 'info', event: 'first' }, { projectRoot: root, env: {} });
      const logPath = path.join(root, 'mobile-automator', '.logs', 'mauto.ndjson');
      expect(fs.readFileSync(logPath, 'utf8')).toContain('first');
    });

    it('MAUTO_LOG_DIR is an explicit override that bypasses the check', () => {
      const root = bareDir();
      const elsewhere = path.join(bareDir(), 'logs');
      fileSink.write(
        { level: 'info', event: 'e' },
        { projectRoot: root, env: { MAUTO_LOG_DIR: elsewhere } }
      );
      expect(fs.readFileSync(path.join(elsewhere, 'mauto.ndjson'), 'utf8')).toContain('"e"');
      expect(fs.readdirSync(root)).toEqual([]);
    });
  });

  it('swallows a write failure instead of throwing', () => {
    const boom = {
      existsSync() { return true; },
      mkdirSync() { throw new Error('EROFS: read-only file system'); },
      statSync() { throw new Error('nope'); },
      appendFileSync() { throw new Error('nope'); },
      renameSync() { throw new Error('nope'); },
    };
    expect(() =>
      fileSink.write({ level: 'info', event: 'e' }, { projectRoot: '/x', env: {}, fs: boom })
    ).not.toThrow();
  });

  it('emits a parseable line for an event containing a quote', () => {
    const line = fileSink.format({ level: 'info', event: 'e', message: 'said "hi"\nnewline' });
    expect(line.endsWith('\n')).toBe(true);
    expect(line.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(line).message).toBe('said "hi"\nnewline');
  });

  it('writes to an explicit logPath when one is given', () => {
    const root = workspace();
    fs.mkdirSync(path.join(root, 'mobile-automator'), { recursive: true });
    const target = path.join(root, 'mobile-automator', '.logs', 'daemon.ndjson');

    fileSink.write(
      { level: 'info', event: 'call.end', tool: 'mobile_press_button' },
      { projectRoot: root, env: {}, logPath: target }
    );

    expect(JSON.parse(fs.readFileSync(target, 'utf8').trim()).tool).toBe('mobile_press_button');
    expect(fs.existsSync(path.join(root, 'mobile-automator', '.logs', 'mauto.ndjson'))).toBe(false);
  });

  it('still refuses to log into a directory that has no workspace, logPath or not', () => {
    const root = bareDir(); // mkdtemp'd, so no mobile-automator/ inside it
    const target = path.join(root, 'mobile-automator', '.logs', 'daemon.ndjson');

    fileSink.write({ level: 'info', event: 'e' }, { projectRoot: root, env: {}, logPath: target });

    expect(fs.existsSync(target)).toBe(false);
  });
});
