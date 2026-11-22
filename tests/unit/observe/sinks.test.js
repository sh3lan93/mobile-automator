'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const stderrSink = require('../../../src/observe/sinks/stderr');
const fileSink = require('../../../src/observe/sinks/file');
const { MAX_LOG_BYTES } = require('../../../src/device/session-log');

// A project that HAS run `mauto setup`: .mobile-automator/ exists, so the file
// sink is allowed to log into it.
function workspace() {
  const root = bareDir();
  fs.mkdirSync(path.join(root, '.mobile-automator'), { recursive: true });
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

  it('escapes terminal control characters in values (#349)', () => {
    const written = [];
    stderrSink.write(
      { level: 'warn', event: 'verb.end', message: '\u001b]0;x\u0007' },
      { stream: { write: (s) => written.push(s) } }
    );
    expect(written[0]).not.toContain('\u001b');
    expect(written[0]).not.toContain('\u0007');
  });

  it('keeps one event on one line even when a value holds a newline (#349)', () => {
    const written = [];
    stderrSink.write(
      { level: 'info\u001b', event: 'e\nv', message: 'a\nfake [error] line' },
      { stream: { write: (s) => written.push(s) } }
    );
    expect(written[0].split('\n')).toHaveLength(2);
    expect(written[0].endsWith('\n')).toBe(true);
    expect(written[0]).not.toContain('\u001b');
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

    const logPath = path.join(root, '.mobile-automator', '.logs', 'mauto.ndjson');
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).verb).toBe('tap');
    expect(JSON.parse(lines[1]).verb).toBe('swipe');
  });

  it('creates the log directory on demand', () => {
    const root = workspace();
    fileSink.write({ level: 'info', event: 'e' }, { projectRoot: root, env: {} });
    expect(fs.existsSync(path.join(root, '.mobile-automator', '.logs'))).toBe(true);
  });

  it('rotates to .1 at the shared 1 MiB cap, keeping one generation', () => {
    const root = workspace();
    const dir = path.join(root, '.mobile-automator', '.logs');
    const logPath = path.join(dir, 'mauto.ndjson');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(logPath, 'x'.repeat(MAX_LOG_BYTES));

    fileSink.write({ level: 'info', event: 'after-rotate' }, { projectRoot: root, env: {} });

    expect(fs.statSync(`${logPath}.1`).size).toBe(MAX_LOG_BYTES);
    expect(fs.readFileSync(logPath, 'utf8')).toContain('after-rotate');
  });

  // "No workspace, no file log." mauto is a CLI a user runs from any directory;
  // creating .mobile-automator/ as a side effect of logging would litter every
  // repo it is invoked in. Worse, it would create the directory WITHOUT the
  // .gitignore that `mauto setup` writes, so a project that never ran setup
  // ends up with an untracked, un-ignored directory holding device serials.
  describe('the workspace gates file logging', () => {
    it('writes nothing when .mobile-automator/ does not exist', () => {
      const root = bareDir();
      fileSink.write({ level: 'info', event: 'e' }, { projectRoot: root, env: {} });
      expect(fs.readdirSync(root)).toEqual([]);
    });

    it('does not create the workspace directory itself', () => {
      const root = bareDir();
      fileSink.write({ level: 'info', event: 'e' }, { projectRoot: root, env: {} });
      expect(fs.existsSync(path.join(root, '.mobile-automator'))).toBe(false);
    });

    it('checks the base dir, not .logs/ — a set-up workspace logs on first run', () => {
      const root = workspace(); // .mobile-automator/ exists; .logs/ does not yet
      fileSink.write({ level: 'info', event: 'first' }, { projectRoot: root, env: {} });
      const logPath = path.join(root, '.mobile-automator', '.logs', 'mauto.ndjson');
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
    // A read-only workspace: .logs/ is missing, so the checked walk tries to
    // create it, and that mkdir fails. Every later call fails too.
    const calls = [];
    const erofs = (name) => () => {
      calls.push(name);
      throw Object.assign(new Error('EROFS: read-only file system'), { code: 'EROFS' });
    };
    const boom = {
      existsSync() { return true; },
      lstatSync(p) {
        if (p === '/x/.mobile-automator') return { isSymbolicLink: () => false, isDirectory: () => true, uid: process.getuid(), mode: 0o755 };
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      },
      mkdirSync: erofs('mkdirSync'),
      realpathSync: (p) => p,
      openSync: erofs('openSync'),
      writeSync: erofs('writeSync'),
      renameSync: erofs('renameSync'),
    };
    expect(() =>
      fileSink.write({ level: 'info', event: 'e' }, { projectRoot: '/x', env: {}, fs: boom })
    ).not.toThrow();
    // The failure under test is the one that happened, not a TypeError from a
    // call the fake does not stub.
    expect(calls).toEqual(['mkdirSync']);
  });

  it('swallows a failed append instead of throwing', () => {
    const root = workspace();
    const opened = [];
    const closed = [];
    const boom = {
      ...fs,
      openSync: (...args) => {
        const fd = fs.openSync(...args);
        opened.push(fd);
        return fd;
      },
      closeSync: (fd) => {
        closed.push(fd);
        fs.closeSync(fd);
      },
      writeSync() { throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }); },
    };
    expect(() =>
      fileSink.write({ level: 'info', event: 'e' }, { projectRoot: root, env: {}, fs: boom })
    ).not.toThrow();
    // The fd is closed despite the failed write.
    expect(opened).toHaveLength(1);
    expect(closed).toEqual(opened);
  });

  it('emits a parseable line for an event containing a quote', () => {
    const line = fileSink.format({ level: 'info', event: 'e', message: 'said "hi"\nnewline' });
    expect(line.endsWith('\n')).toBe(true);
    expect(line.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(line).message).toBe('said "hi"\nnewline');
  });

  it('writes to an explicit logPath when one is given', () => {
    const root = workspace();
    fs.mkdirSync(path.join(root, '.mobile-automator'), { recursive: true });
    const target = path.join(root, '.mobile-automator', '.logs', 'daemon.ndjson');

    fileSink.write(
      { level: 'info', event: 'call.end', tool: 'mobile_press_button' },
      { projectRoot: root, env: {}, logPath: target }
    );

    expect(JSON.parse(fs.readFileSync(target, 'utf8').trim()).tool).toBe('mobile_press_button');
    expect(fs.existsSync(path.join(root, '.mobile-automator', '.logs', 'mauto.ndjson'))).toBe(false);
  });

  it('holds no file descriptor between events', () => {
    // Rotation renames the file; a held fd would keep writing into the rotated
    // inode. That matters most for the daemon, the one long-lived writer in the
    // system, but it is a property of the sink: it opens, appends and closes per
    // event. Proven by rotating BETWEEN two writes and checking the second
    // landed in the fresh file.
    const root = workspace();
    const logPath = path.join(root, '.mobile-automator', '.logs', 'daemon.ndjson');

    fileSink.write({ level: 'info', event: 'daemon.start' }, { projectRoot: root, env: {}, logPath });
    fs.renameSync(logPath, `${logPath}.1`);
    fileSink.write(
      { level: 'info', event: 'daemon.stop', stop_reason: 'idle' },
      { projectRoot: root, env: {}, logPath }
    );

    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).event).toBe('daemon.stop');
  });

  it('still refuses to log into a directory that has no workspace, logPath or not', () => {
    const root = bareDir(); // mkdtemp'd, so no .mobile-automator/ inside it
    const target = path.join(root, '.mobile-automator', '.logs', 'daemon.ndjson');

    fileSink.write({ level: 'info', event: 'e' }, { projectRoot: root, env: {}, logPath: target });

    expect(fs.existsSync(target)).toBe(false);
  });
});

describe('file sink bounding modes', () => {
  const { MAX_LOG_BYTES: MAX_LOG_BYTES_CANONICAL } = require('../../../src/util/log-rotate');

  function boundedWorkspace() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-sink-bound-'));
    fs.mkdirSync(path.join(root, '.mobile-automator'), { recursive: true });
    return root;
  }

  const event = { ts: '2026-09-05T10:00:00.000Z', v: 1, level: 'info', event: 'verb.end' };

  it("defaults to 'rotate' — unchanged behaviour for mauto.ndjson", () => {
    const root = boundedWorkspace();
    const target = path.join(root, '.mobile-automator', '.logs', 'mauto.ndjson');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'x'.repeat(MAX_LOG_BYTES_CANONICAL));

    fileSink.write(event, { projectRoot: root, env: {}, logPath: target });

    expect(fs.existsSync(`${target}.1`)).toBe(true);
    expect(fs.readFileSync(target, 'utf8').trim().split('\n')).toHaveLength(1);
  });

  // The one place the shared rotation policy is wrong. A trace's CONTENT is the
  // measurement: rotating renames the run's beginning away, so the next
  // finalize would compute the span of an arbitrary suffix and report a
  // three-minute run as forty seconds — measured-looking fiction.
  it("'cap' stops appending instead of rotating the run's beginning away", () => {
    const root = boundedWorkspace();
    const target = path.join(root, '.mobile-automator', '.logs', 'run-smoke.ndjson');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const original = 'x'.repeat(MAX_LOG_BYTES_CANONICAL);
    fs.writeFileSync(target, original);

    fileSink.write(event, { projectRoot: root, env: {}, logPath: target, bound: 'cap' });

    expect(fs.existsSync(`${target}.1`)).toBe(false);
    expect(fs.readFileSync(target, 'utf8')).toBe(original);
  });

  it("'cap' measures the cap on the trace it opened, not by a stat of the path (#348)", () => {
    const root = boundedWorkspace();
    const target = path.join(root, '.mobile-automator', '.logs', 'run-smoke.ndjson');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'x'.repeat(MAX_LOG_BYTES_CANONICAL));
    const statSaysEmpty = { ...fs, statSync: () => ({ size: 0 }) };

    fileSink.write(event, { projectRoot: root, env: {}, fs: statSaysEmpty, logPath: target, bound: 'cap' });

    expect(fs.statSync(target).size).toBe(MAX_LOG_BYTES_CANONICAL);
  });

  it("'cap' appends normally below the cap", () => {
    const root = boundedWorkspace();
    const target = path.join(root, '.mobile-automator', '.logs', 'run-smoke.ndjson');

    fileSink.write(event, { projectRoot: root, env: {}, logPath: target, bound: 'cap' });
    fileSink.write(event, { projectRoot: root, env: {}, logPath: target, bound: 'cap' });

    const lines = fs.readFileSync(target, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).event).toBe('verb.end');
  });

  it('atCap answers the same question finalize needs to ask', () => {
    const root = boundedWorkspace();
    const target = path.join(root, '.mobile-automator', '.logs', 'run-smoke.ndjson');
    fs.mkdirSync(path.dirname(target), { recursive: true });

    expect(fileSink.atCap(target)).toBe(false); // no file yet
    fs.writeFileSync(target, 'small');
    expect(fileSink.atCap(target)).toBe(false);
    fs.writeFileSync(target, 'x'.repeat(MAX_LOG_BYTES_CANONICAL));
    expect(fileSink.atCap(target)).toBe(true);
  });

  it("'cap' still respects the no-workspace rule", () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-sink-bare-'));
    const target = path.join(bare, '.mobile-automator', '.logs', 'run-smoke.ndjson');

    fileSink.write(event, { projectRoot: bare, env: {}, logPath: target, bound: 'cap' });

    expect(fs.existsSync(target)).toBe(false);
  });
});

// #347: .logs/ and the files in it sit in a workspace a cloned repo can fill
// with symlinks. The sink walks the log directory through safe-fs and opens
// the leaf O_NOFOLLOW, so a link drops the event silently (a sink never fails
// a verb) and the link's target is never appended to, rotated or created.
describe('file sink never follows a link (#347)', () => {
  const { CANARY, tmpDir, snapshot } = require('../../helpers/workspace-safety');
  const { MAX_LOG_BYTES: CAP } = require('../../../src/util/log-rotate');

  function project() {
    const base = tmpDir('mauto-sink-confine-');
    const root = path.join(base, 'project');
    const outside = path.join(base, 'outside');
    fs.mkdirSync(path.join(root, '.mobile-automator'), { recursive: true });
    fs.mkdirSync(outside);
    return { root, logs: path.join(root, '.mobile-automator', '.logs'), outside };
  }

  const event = { level: 'info', event: 'verb.end', verb: 'tap' };

  it('.logs -> outside dir: no write, no throw', () => {
    const { root, logs, outside } = project();
    fs.symlinkSync(outside, logs);

    expect(() => fileSink.write(event, { projectRoot: root, env: {} })).not.toThrow();

    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('a leaf mauto.ndjson -> outside file is not appended to', () => {
    const { root, logs, outside } = project();
    const target = path.join(outside, 'secret.txt');
    fs.writeFileSync(target, `${CANARY}\n`);
    fs.mkdirSync(logs);
    fs.symlinkSync(target, path.join(logs, 'mauto.ndjson'));
    const before = snapshot(outside);

    fileSink.write(event, { projectRoot: root, env: {} });

    expect(snapshot(outside)).toEqual(before);
    expect(fs.lstatSync(path.join(logs, 'mauto.ndjson')).isSymbolicLink()).toBe(true);
  });

  it('.logs -> outside dir holding an over-cap mauto.ndjson is not rotated', () => {
    const { root, logs, outside } = project();
    fs.writeFileSync(path.join(outside, 'mauto.ndjson'), 'x'.repeat(CAP));
    fs.symlinkSync(outside, logs);
    const before = snapshot(outside);

    fileSink.write(event, { projectRoot: root, env: {} });

    expect(snapshot(outside)).toEqual(before);
    expect(fs.existsSync(path.join(outside, 'mauto.ndjson.1'))).toBe(false);
  });

  it('a run trace (bound: cap) through a symlinked .logs is not written', () => {
    const { root, logs, outside } = project();
    fs.symlinkSync(outside, logs);

    fileSink.write(event, { projectRoot: root, env: {}, logPath: path.join(logs, 'run-r1.ndjson'), bound: 'cap' });

    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it("MAUTO_LOG_DIR outside the workspace is the user's own call and still logs", () => {
    const { root } = project();
    const elsewhere = path.join(tmpDir('mauto-sink-elsewhere-'), 'logs');

    fileSink.write(event, { projectRoot: root, env: { MAUTO_LOG_DIR: elsewhere } });

    expect(JSON.parse(fs.readFileSync(path.join(elsewhere, 'mauto.ndjson'), 'utf8')).verb).toBe('tap');
    expect(fs.existsSync(path.join(root, '.mobile-automator', '.logs'))).toBe(false);
  });
});
