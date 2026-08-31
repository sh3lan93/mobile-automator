'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { openLogFd, MAX_LOG_BYTES } = require('../../../src/device/session-log');
const { sessionDir } = require('../../../src/device/session-paths');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-log-'));
}

describe('session-log', () => {
  const roots = [];

  function newRoot() {
    const root = tempRoot();
    roots.push(root);
    return root;
  }

  afterAll(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  });

  test('MAX_LOG_BYTES is 1 MiB', () => {
    expect(MAX_LOG_BYTES).toBe(1024 * 1024);
  });

  test('creates the .session directory when absent', () => {
    const root = newRoot();
    expect(fs.existsSync(sessionDir(root))).toBe(false);

    const handle = openLogFd(root);
    expect(handle).not.toBeNull();
    handle.close();

    expect(fs.existsSync(sessionDir(root))).toBe(true);
    expect(handle.path).toBe(path.join(sessionDir(root), 'daemon.log'));
  });

  test('opens in append mode — pre-existing content survives and new writes land after it', () => {
    const root = newRoot();
    fs.mkdirSync(sessionDir(root), { recursive: true });
    const logPath = path.join(sessionDir(root), 'daemon.log');
    fs.writeFileSync(logPath, 'winner crash trace\n');

    const handle = openLogFd(root);
    fs.writeSync(handle.fd, 'loser ELOCKED\n');
    handle.close();

    expect(fs.readFileSync(logPath, 'utf8')).toBe('winner crash trace\nloser ELOCKED\n');
  });

  test('rotates to daemon.log.1 when the existing log is at/over maxBytes', () => {
    const root = newRoot();
    fs.mkdirSync(sessionDir(root), { recursive: true });
    const logPath = path.join(sessionDir(root), 'daemon.log');
    fs.writeFileSync(logPath, 'x'.repeat(64));

    const handle = openLogFd(root, { maxBytes: 64 });
    handle.close();

    expect(fs.readFileSync(logPath + '.1', 'utf8')).toBe('x'.repeat(64));
    expect(fs.statSync(logPath).size).toBe(0);
  });

  test('does not rotate when the existing log is under the threshold', () => {
    const root = newRoot();
    fs.mkdirSync(sessionDir(root), { recursive: true });
    const logPath = path.join(sessionDir(root), 'daemon.log');
    fs.writeFileSync(logPath, 'x'.repeat(63));

    const handle = openLogFd(root, { maxBytes: 64 });
    handle.close();

    expect(fs.existsSync(logPath + '.1')).toBe(false);
    expect(fs.readFileSync(logPath, 'utf8')).toBe('x'.repeat(63));
  });

  test('rotation overwrites an existing daemon.log.1 — a single generation is deliberate', () => {
    const root = newRoot();
    fs.mkdirSync(sessionDir(root), { recursive: true });
    const logPath = path.join(sessionDir(root), 'daemon.log');
    fs.writeFileSync(logPath + '.1', 'ancient history');
    fs.writeFileSync(logPath, 'y'.repeat(64));

    const handle = openLogFd(root, { maxBytes: 64 });
    handle.close();

    expect(fs.readFileSync(logPath + '.1', 'utf8')).toBe('y'.repeat(64));
  });

  test('returns null when openSync throws (read-only workspace)', () => {
    const fakeFs = {
      mkdirSync() {},
      statSync() { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
      renameSync() {},
      openSync() { throw Object.assign(new Error('EROFS'), { code: 'EROFS' }); },
      closeSync() {},
    };
    expect(openLogFd('/proj', { fs: fakeFs })).toBeNull();
  });

  test('returns null when mkdirSync throws', () => {
    const fakeFs = {
      mkdirSync() { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); },
      statSync() { throw new Error('should not reach'); },
      renameSync() {},
      openSync() { throw new Error('should not reach'); },
      closeSync() {},
    };
    expect(openLogFd('/proj', { fs: fakeFs })).toBeNull();
  });

  test('a missing log file is not an error — no rotation, still opens', () => {
    const closed = [];
    const fakeFs = {
      mkdirSync() {},
      statSync() { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
      renameSync() { throw new Error('must not rotate a missing file'); },
      openSync() { return 42; },
      closeSync(fd) { closed.push(fd); },
    };
    const handle = openLogFd('/proj', { fs: fakeFs });
    expect(handle.fd).toBe(42);
    handle.close();
    expect(closed).toEqual([42]);
  });

  test('close() closes the fd and is safe to call twice', () => {
    const closed = [];
    const fakeFs = {
      mkdirSync() {},
      statSync() { return { size: 0 }; },
      renameSync() {},
      openSync() { return 7; },
      closeSync(fd) { closed.push(fd); },
    };
    const handle = openLogFd('/proj', { fs: fakeFs });
    handle.close();
    handle.close();
    expect(closed).toEqual([7]);
  });

  test('write() appends to the log and never throws when writeSync does', () => {
    const root = newRoot();
    const handle = openLogFd(root);
    handle.write('=== banner ===\n');
    handle.close();

    expect(fs.readFileSync(handle.path, 'utf8')).toBe('=== banner ===\n');

    // Best-effort by contract: a full disk must not take down a spawn.
    const fakeFs = {
      mkdirSync() {},
      statSync() { return { size: 0 }; },
      renameSync() {},
      openSync() { return 7; },
      writeSync() { throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }); },
      closeSync() {},
    };
    const throwing = openLogFd('/proj', { fs: fakeFs });
    expect(() => throwing.write('anything')).not.toThrow();
  });

  test('close() never throws even when closeSync does', () => {
    const fakeFs = {
      mkdirSync() {},
      statSync() { return { size: 0 }; },
      renameSync() {},
      openSync() { return 7; },
      closeSync() { throw Object.assign(new Error('EBADF'), { code: 'EBADF' }); },
    };
    const handle = openLogFd('/proj', { fs: fakeFs });
    expect(() => handle.close()).not.toThrow();
  });

  test('returns null when rotation fails — any throw degrades to no logging', () => {
    const fakeFs = {
      mkdirSync() {},
      statSync() { return { size: 1e9 }; },
      renameSync() { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); },
      openSync() { return 9; },
      closeSync() {},
    };
    expect(openLogFd('/proj', { fs: fakeFs })).toBeNull();
  });
});
