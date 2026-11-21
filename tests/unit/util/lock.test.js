'use strict';

// #345: the advisory lock must give up within MAX_WAIT_MS whatever sits at the
// lock path. A committed dangling symlink used to spin it forever: open('wx')
// on the link fails EEXIST, statSync follows the link and fails ENOENT, and the
// ENOENT branch retried with no deadline.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { acquire, release, STALE_MS, RETRY_MS, MAX_WAIT_MS } = require('../../../src/util/lock');
const { UnsafePathError } = require('../../../src/workspace/safe-fs');

const MAX_SLEEPS = MAX_WAIT_MS / RETRY_MS + 2;

function tmpDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-util-lock-')));
}

function errno(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

// A virtual clock: sleep advances it, and so does every read (an immediate
// retry still costs real time), so a loop that never sleeps still reaches the
// deadline instead of hanging the test.
function fakeClock() {
  let t = 1_000_000;
  const sleeps = [];
  return {
    now: () => (t += 1),
    sleep: (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    sleeps,
  };
}

// Fail loudly instead of hanging when a regression makes the loop unbounded.
function capped(fn, max = 100_000) {
  let calls = 0;
  return (...args) => {
    calls += 1;
    if (calls > max) throw new Error(`unbounded retry: ${max} calls`);
    return fn(...args);
  };
}

function fakeFs(overrides) {
  return {
    mkdirSync: () => undefined,
    openSync: capped(() => {
      throw errno('EEXIST');
    }),
    lstatSync: () => {
      throw errno('ENOENT');
    },
    unlinkSync: () => undefined,
    writeSync: () => undefined,
    closeSync: () => undefined,
    ...overrides,
  };
}

describe('util/lock deadline (#345)', () => {
  test('a lock that keeps vanishing (EEXIST then ENOENT) times out within the deadline', () => {
    const clock = fakeClock();
    const lockFs = fakeFs();
    expect(() => acquire('/ws/.session/memory.lock', { ...clock, fs: lockFs })).toThrow(/could not acquire/);
    expect(clock.sleeps.length).toBeGreaterThan(0);
    expect(clock.sleeps.length).toBeLessThan(MAX_SLEEPS);
  });

  test('a non-regular entry that unlink removes but open keeps refusing still times out', () => {
    const clock = fakeClock();
    const unlinked = [];
    const lockFs = fakeFs({
      lstatSync: () => ({ isFile: () => false, isSymbolicLink: () => true, mtimeMs: clock.now() }),
      unlinkSync: capped((p) => unlinked.push(p)),
    });
    expect(() => acquire('/ws/.session/memory.lock', { ...clock, fs: lockFs })).toThrow(/could not acquire/);
    expect(unlinked.length).toBeGreaterThan(0);
    expect(clock.sleeps.length).toBeLessThan(MAX_SLEEPS);
  });

  test('a failed unlink backs off rather than spinning', () => {
    const clock = fakeClock();
    const lockFs = fakeFs({
      lstatSync: () => ({ isFile: () => true, isSymbolicLink: () => false, mtimeMs: 0 }),
      unlinkSync: () => {
        throw errno('EPERM');
      },
    });
    expect(() => acquire('/ws/.session/memory.lock', { ...clock, fs: lockFs })).toThrow(/could not acquire/);
    expect(clock.sleeps.length).toBeGreaterThan(0);
    expect(clock.sleeps.length).toBeLessThan(MAX_SLEEPS);
  });

  test('a real dangling symlink at the lock path is replaced, never followed', () => {
    const dir = tmpDir();
    const outside = path.join(dir, 'outside');
    fs.mkdirSync(outside);
    const lockDir = path.join(dir, 'locks');
    fs.mkdirSync(lockDir);
    const lp = path.join(lockDir, 'memory.lock');
    fs.symlinkSync(path.join(outside, 'target'), lp);

    acquire(lp);
    try {
      expect(fs.lstatSync(lp).isFile()).toBe(true);
      expect(fs.existsSync(path.join(outside, 'target'))).toBe(false);
      expect(fs.readdirSync(outside)).toEqual([]);
    } finally {
      release(lp);
    }
  });

  test('with a projectRoot, a dangling symlink lock inside the workspace is replaced too', () => {
    const root = tmpDir();
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    const session = path.join(root, '.mobile-automator', '.session');
    fs.mkdirSync(session, { recursive: true });
    const lp = path.join(session, 'memory.lock');
    fs.symlinkSync(path.join(outside, 'target'), lp);

    acquire(lp, { projectRoot: root });
    try {
      expect(fs.lstatSync(lp).isFile()).toBe(true);
      expect(fs.readdirSync(outside)).toEqual([]);
    } finally {
      release(lp);
    }
  });

  test('with a projectRoot, a lock directory that is a symlink out of the workspace is refused', () => {
    const root = tmpDir();
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    fs.mkdirSync(path.join(root, '.mobile-automator'));
    fs.symlinkSync(outside, path.join(root, '.mobile-automator', '.session'));
    const lp = path.join(root, '.mobile-automator', '.session', 'memory.lock');

    let caught;
    try {
      acquire(lp, { projectRoot: root });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnsafePathError);
    expect(caught.reason).toBe('symlink');
    expect(fs.readdirSync(outside)).toEqual([]);
  });
});

describe('util/lock existing behaviour', () => {
  test('a stale lock is broken and re-acquired', () => {
    const lp = path.join(tmpDir(), 'x.lock');
    acquire(lp);
    const past = new Date(Date.now() - STALE_MS - 1000);
    fs.utimesSync(lp, past, past);
    expect(() => acquire(lp)).not.toThrow();
    release(lp);
  });

  test('a live lock times out', () => {
    const lp = path.join(tmpDir(), 'x.lock');
    acquire(lp);
    const clock = fakeClock();
    try {
      expect(() => acquire(lp, clock)).toThrow(/could not acquire/);
      expect(clock.sleeps.length).toBeLessThan(MAX_SLEEPS);
    } finally {
      release(lp);
    }
  });

  test('a lock in a missing directory creates the directory (no projectRoot)', () => {
    const lp = path.join(tmpDir(), 'a', 'b', 'x.lock');
    acquire(lp);
    expect(fs.lstatSync(lp).isFile()).toBe(true);
    release(lp);
  });

  test('with a projectRoot, a missing lock directory is created inside the workspace', () => {
    const root = tmpDir();
    const lp = path.join(root, '.mobile-automator', 'results', 'r1.lock');
    acquire(lp, { projectRoot: root });
    expect(fs.lstatSync(lp).isFile()).toBe(true);
    release(lp);
  });
});
