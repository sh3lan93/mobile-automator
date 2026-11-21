'use strict';

// #345: the advisory lock must give up within MAX_WAIT_MS whatever sits at the
// lock path. A committed dangling symlink used to spin it forever: open('wx')
// on the link fails EEXIST, statSync follows the link and fails ENOENT, and the
// ENOENT branch retried with no deadline.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { acquire, release, withLock, STALE_MS, RETRY_MS, MAX_WAIT_MS } = require('../../../src/util/lock');
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

// A real project root with `.mobile-automator/.session/`, so safe-fs walks real
// directories; the fake fs below only lies about the lock path itself.
function workspaceRoot() {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, '.mobile-automator', '.session'), { recursive: true });
  return { root, lp: path.join(root, '.mobile-automator', '.session', 'memory.lock') };
}

// Real fs for every path but `lp`: open on it always fails EEXIST, lstat on it
// fails ENOENT unless overridden.
function fakeFs(lp, overrides = {}) {
  const at = (fake, real) => (p, ...rest) => (p === lp ? fake(p, ...rest) : real(p, ...rest));
  return {
    ...fs,
    openSync: at(
      capped(() => {
        throw errno('EEXIST');
      }),
      fs.openSync
    ),
    lstatSync: at(
      overrides.lstatSync ||
        (() => {
          throw errno('ENOENT');
        }),
      fs.lstatSync
    ),
    unlinkSync: at(overrides.unlinkSync || (() => undefined), fs.unlinkSync),
  };
}

describe('util/lock deadline (#345)', () => {
  test('a lock that keeps vanishing (EEXIST then ENOENT) times out within the deadline', () => {
    const clock = fakeClock();
    const { root, lp } = workspaceRoot();
    const lockFs = fakeFs(lp);
    expect(() => acquire(root, lp, { ...clock, fs: lockFs })).toThrow(/could not acquire/);
    expect(clock.sleeps.length).toBeGreaterThan(0);
    expect(clock.sleeps.length).toBeLessThan(MAX_SLEEPS);
  });

  test('a non-regular entry that unlink removes but open keeps refusing still times out', () => {
    const clock = fakeClock();
    const unlinked = [];
    const { root, lp } = workspaceRoot();
    const lockFs = fakeFs(lp, {
      lstatSync: () => ({ isFile: () => false, isSymbolicLink: () => true, mtimeMs: clock.now() }),
      unlinkSync: capped((p) => unlinked.push(p)),
    });
    expect(() => acquire(root, lp, { ...clock, fs: lockFs })).toThrow(/could not acquire/);
    expect(unlinked.length).toBeGreaterThan(0);
    expect(clock.sleeps.length).toBeLessThan(MAX_SLEEPS);
  });

  test('a failed unlink backs off rather than spinning', () => {
    const clock = fakeClock();
    const { root, lp } = workspaceRoot();
    const lockFs = fakeFs(lp, {
      lstatSync: () => ({ isFile: () => true, isSymbolicLink: () => false, mtimeMs: 0 }),
      unlinkSync: () => {
        throw errno('EPERM');
      },
    });
    expect(() => acquire(root, lp, { ...clock, fs: lockFs })).toThrow(/could not acquire/);
    expect(clock.sleeps.length).toBeGreaterThan(0);
    expect(clock.sleeps.length).toBeLessThan(MAX_SLEEPS);
  });

  test('a non-regular entry another process already removed (unlink ENOENT) is retried, not refused', () => {
    const clock = fakeClock();
    const { root, lp } = workspaceRoot();
    let opens = 0;
    let unlinks = 0;
    const lockFs = {
      ...fakeFs(lp, {
        lstatSync: () => ({ isFile: () => false, isSymbolicLink: () => true, mtimeMs: clock.now() }),
        unlinkSync: () => {
          unlinks += 1;
          throw errno('ENOENT');
        },
      }),
      openSync: (p, ...rest) => {
        if (p === lp && opens++ === 0) throw errno('EEXIST');
        return fs.openSync(p, ...rest);
      },
    };
    expect(() => acquire(root, lp, { ...clock, fs: lockFs })).not.toThrow();
    expect(unlinks).toBe(1);
    expect(fs.lstatSync(lp).isFile()).toBe(true);
  });

  test('a real directory at the lock path is refused at once and left in place', () => {
    const clock = fakeClock();
    const { root, lp } = workspaceRoot();
    fs.mkdirSync(lp);

    let caught;
    try {
      acquire(root, lp, clock);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnsafePathError);
    expect(caught.reason).toBe('not_regular');
    expect(caught.kind).toBe('environment');
    expect(clock.sleeps).toEqual([]);
    expect(fs.lstatSync(lp).isDirectory()).toBe(true);
  });

  test('a real dangling symlink lock inside the workspace is replaced, never followed', () => {
    const root = tmpDir();
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    const session = path.join(root, '.mobile-automator', '.session');
    fs.mkdirSync(session, { recursive: true });
    const lp = path.join(session, 'memory.lock');
    fs.symlinkSync(path.join(outside, 'target'), lp);

    acquire(root, lp);
    try {
      expect(fs.lstatSync(lp).isFile()).toBe(true);
      expect(fs.existsSync(path.join(outside, 'target'))).toBe(false);
      expect(fs.readdirSync(outside)).toEqual([]);
    } finally {
      release(lp);
    }
  });

  test('a lock directory that is a symlink out of the workspace is refused', () => {
    const root = tmpDir();
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    fs.mkdirSync(path.join(root, '.mobile-automator'));
    fs.symlinkSync(outside, path.join(root, '.mobile-automator', '.session'));
    const lp = path.join(root, '.mobile-automator', '.session', 'memory.lock');

    let caught;
    try {
      acquire(root, lp);
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
    const { root, lp } = workspaceRoot();
    acquire(root, lp);
    const past = new Date(Date.now() - STALE_MS - 1000);
    fs.utimesSync(lp, past, past);
    expect(() => acquire(root, lp)).not.toThrow();
    release(lp);
  });

  test('a live lock times out', () => {
    const { root, lp } = workspaceRoot();
    acquire(root, lp);
    const clock = fakeClock();
    try {
      expect(() => acquire(root, lp, clock)).toThrow(/could not acquire/);
      expect(clock.sleeps.length).toBeLessThan(MAX_SLEEPS);
    } finally {
      release(lp);
    }
  });

  test('a missing lock directory is created inside the workspace', () => {
    const root = tmpDir();
    const lp = path.join(root, '.mobile-automator', 'results', 'r1.lock');
    acquire(root, lp);
    expect(fs.lstatSync(lp).isFile()).toBe(true);
    release(lp);
  });

  test('a lock path outside the workspace is refused, and nothing is created', () => {
    const root = tmpDir();
    const lp = path.join(root, 'elsewhere', 'x.lock');
    let caught;
    try {
      acquire(root, lp);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnsafePathError);
    expect(caught.reason).toBe('escape');
    expect(fs.existsSync(path.join(root, 'elsewhere'))).toBe(false);
  });

  test.each([
    ['acquire without a project root', () => acquire('/ws/.mobile-automator/.session/memory.lock')],
    ['withLock without a project root', () => withLock('/ws/.mobile-automator/.session/memory.lock', () => 1)],
  ])('%s throws a TypeError before touching the fs', (_label, call) => {
    expect(call).toThrow(TypeError);
  });
});
