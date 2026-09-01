'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { openDaemonLog, IGNORED, MAX_LOG_BYTES } = require('../../../src/device/session-log');
const { sessionDir, logFilePath } = require('../../../src/device/session-paths');

// One fake-fs shape for the whole file. Defaults are the happy path (an empty
// existing log, fd 7); each test overrides only the call it is about, so the
// override IS the test's subject rather than noise around it.
function makeFakeFs(overrides = {}) {
  const calls = { renamed: [], closed: [], written: [] };
  return Object.assign(
    {
      calls,
      mkdirSync() {},
      statSync() { return { size: 0 }; },
      renameSync(from, to) { calls.renamed.push([from, to]); },
      openSync() { return 7; },
      writeSync(fd, text) { calls.written.push([fd, text]); },
      closeSync(fd) { calls.closed.push(fd); },
    },
    overrides
  );
}

const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });

describe('session-log', () => {
  const roots = [];

  function newRoot() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-log-'));
    roots.push(root);
    return root;
  }

  afterAll(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  });

  // --- the stdio contract: the load-bearing guard for #163 ------------------
  //
  // This is the assertion that keeps the fix alive. stdout AND stderr must be
  // the log's fd: point fd 2 anywhere else and the daemon's stack traces —
  // plus mobile-mcp's stderr, which the MCP stdio transport 'inherit's — go
  // back to /dev/null. session-spawn only passes this value through, so the
  // guard belongs here, where the decision is made.
  test('stdout AND stderr are wired to the log fd', () => {
    const handle = openDaemonLog('/proj', { fs: makeFakeFs() });
    expect(handle.stdio).toEqual(['ignore', 7, 7]);
  });

  test('the degraded handle is today’s stdio: ignore, not null', () => {
    const fakeFs = makeFakeFs({ openSync() { throw Object.assign(new Error('EROFS'), { code: 'EROFS' }); } });
    const handle = openDaemonLog('/proj', { fs: fakeFs });
    expect(handle).toBe(IGNORED);
    expect(handle.stdio).toBe('ignore');
    // Callers must never have to null-check, so the no-op members have to exist.
    expect(() => { handle.write('x'); handle.close(); }).not.toThrow();
  });

  test('an unwritable workspace degrades rather than throwing', () => {
    const fakeFs = makeFakeFs({ mkdirSync() { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); } });
    expect(openDaemonLog('/proj', { fs: fakeFs })).toBe(IGNORED);
  });

  // --- rotation is best-effort; the log is not ------------------------------

  test('rotates to daemon.log.1 when the existing log is at/over maxBytes', () => {
    const root = newRoot();
    fs.mkdirSync(sessionDir(root), { recursive: true });
    const logPath = logFilePath(root);
    fs.writeFileSync(logPath, 'x'.repeat(64));

    openDaemonLog(root, { maxBytes: 64 }).close();

    expect(fs.readFileSync(`${logPath}.1`, 'utf8')).toBe('x'.repeat(64));
    expect(fs.statSync(logPath).size).toBe(0);
  });

  test('does not rotate when the existing log is under the threshold', () => {
    const root = newRoot();
    fs.mkdirSync(sessionDir(root), { recursive: true });
    const logPath = logFilePath(root);
    fs.writeFileSync(logPath, 'x'.repeat(63));

    openDaemonLog(root, { maxBytes: 64 }).close();

    expect(fs.existsSync(`${logPath}.1`)).toBe(false);
    expect(fs.readFileSync(logPath, 'utf8')).toBe('x'.repeat(63));
  });

  test('rotation overwrites an existing daemon.log.1 — a single generation is deliberate', () => {
    const root = newRoot();
    fs.mkdirSync(sessionDir(root), { recursive: true });
    const logPath = logFilePath(root);
    fs.writeFileSync(`${logPath}.1`, 'ancient history');
    fs.writeFileSync(logPath, 'y'.repeat(64));

    openDaemonLog(root, { maxBytes: 64 }).close();

    expect(fs.readFileSync(`${logPath}.1`, 'utf8')).toBe('y'.repeat(64));
  });

  test('a missing log file is not an error — no rotation, still opens', () => {
    const fakeFs = makeFakeFs({
      statSync() { throw enoent(); },
      renameSync() { throw new Error('must not rotate a missing file'); },
    });
    const handle = openDaemonLog('/proj', { fs: fakeFs });
    expect(handle.stdio).toEqual(['ignore', 7, 7]);
    expect(fakeFs.calls.renamed).toEqual([]);
  });

  // The inverse of the obvious policy, and the one worth stating out loud:
  // rotation is a disk guard, the diagnostics are the point. Two verbs racing
  // to spawn at the 1 MiB boundary both see an oversized log; one wins the
  // rename and the other gets ENOENT. Giving up on logging there would blind
  // us at exactly the moment something is wrong enough to spawn twice.
  test('a rotation failure still yields a usable log — an oversized log beats no log', () => {
    const fakeFs = makeFakeFs({
      statSync() { return { size: 1e9 }; },
      renameSync() { throw enoent(); }, // a concurrent spawn already rotated
    });
    const handle = openDaemonLog('/proj', { fs: fakeFs });
    expect(handle).not.toBe(IGNORED);
    expect(handle.stdio).toEqual(['ignore', 7, 7]);
  });

  test('an unreadable log directory does not block the open either', () => {
    const fakeFs = makeFakeFs({
      statSync() { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); },
    });
    expect(openDaemonLog('/proj', { fs: fakeFs }).stdio).toEqual(['ignore', 7, 7]);
  });

  // --- append semantics, write, close ---------------------------------------

  test('opens in append mode — pre-existing content survives and new writes land after it', () => {
    const root = newRoot();
    fs.mkdirSync(sessionDir(root), { recursive: true });
    const logPath = logFilePath(root);
    fs.writeFileSync(logPath, 'winner crash trace\n');

    const handle = openDaemonLog(root);
    handle.write('loser ELOCKED\n');
    handle.close();

    expect(fs.readFileSync(logPath, 'utf8')).toBe('winner crash trace\nloser ELOCKED\n');
  });

  test('creates the .session directory when absent', () => {
    const root = newRoot();
    expect(fs.existsSync(sessionDir(root))).toBe(false);

    openDaemonLog(root).close();

    expect(fs.existsSync(logFilePath(root))).toBe(true);
  });

  test('write() never throws when writeSync does — a full disk must not abort a spawn', () => {
    const fakeFs = makeFakeFs({
      writeSync() { throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }); },
    });
    const handle = openDaemonLog('/proj', { fs: fakeFs });
    expect(() => handle.write('anything')).not.toThrow();
  });

  test('close() releases the fd once and is safe to call twice', () => {
    const fakeFs = makeFakeFs();
    const handle = openDaemonLog('/proj', { fs: fakeFs });
    handle.close();
    handle.close();
    expect(fakeFs.calls.closed).toEqual([7]);
  });

  test('close() never throws even when closeSync does', () => {
    const fakeFs = makeFakeFs({
      closeSync() { throw Object.assign(new Error('EBADF'), { code: 'EBADF' }); },
    });
    const handle = openDaemonLog('/proj', { fs: fakeFs });
    expect(() => handle.close()).not.toThrow();
  });

  test('MAX_LOG_BYTES bounds the log at a size a crash loop cannot outrun quietly', () => {
    const root = newRoot();
    fs.mkdirSync(sessionDir(root), { recursive: true });
    fs.writeFileSync(logFilePath(root), 'z'.repeat(MAX_LOG_BYTES));

    openDaemonLog(root).close(); // default maxBytes

    expect(fs.existsSync(`${logFilePath(root)}.1`)).toBe(true);
  });
});
