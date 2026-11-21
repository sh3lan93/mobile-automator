'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { acquire, release, withLock, STALE_MS } = require('../../../src/memory/lock');

// A real project root with a `.mobile-automator/` dir; the lock sits where
// memory/paths puts it, in `.mobile-automator/.session/`.
function tmpLock() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-lock-')));
  fs.mkdirSync(path.join(root, '.mobile-automator'));
  return { root, lp: path.join(root, '.mobile-automator', '.session', 'memory.lock') };
}

describe('memory/lock', () => {
  test('withLock runs fn and releases', () => {
    const { root, lp } = tmpLock();
    const out = withLock(root, lp, () => 42);
    expect(out).toBe(42);
    expect(fs.existsSync(lp)).toBe(false); // released
  });

  test('a held lock blocks a second acquire until it times out', () => {
    const { root, lp } = tmpLock();
    acquire(root, lp);
    let now = 1000;
    const clock = () => now;
    const sleep = () => { now += 100; }; // advance virtual time instead of real sleep
    expect(() => acquire(root, lp, { now: clock, sleep })).toThrow(/could not acquire/);
    release(lp);
  });

  test('a stale lock (older than STALE_MS) is broken and re-acquired', () => {
    const { root, lp } = tmpLock();
    acquire(root, lp);
    // Backdate the lockfile mtime beyond the stale window.
    const past = new Date(Date.now() - STALE_MS - 1000);
    fs.utimesSync(lp, past, past);
    // A fresh acquire should break it and succeed.
    expect(() => acquire(root, lp)).not.toThrow();
    release(lp);
  });

  test('a persistent non-ENOENT lstat error times out instead of hanging', () => {
    const { root, lp } = tmpLock();
    acquire(root, lp); // held — a second acquire must go down the EEXIST branch

    let now = 1000;
    const clock = () => now;
    const sleep = () => { now += 100; }; // advance virtual time instead of real sleep

    // Only the lock path fails: safe-fs still walks the real directories.
    const realLstat = fs.lstatSync;
    const statSpy = jest.spyOn(fs, 'lstatSync').mockImplementation((p, ...rest) => {
      if (p !== lp) return realLstat(p, ...rest);
      const e = new Error('EACCES: permission denied');
      e.code = 'EACCES';
      throw e;
    });

    try {
      expect(() => acquire(root, lp, { now: clock, sleep })).toThrow(/could not acquire/);
    } finally {
      statSpy.mockRestore();
      release(lp);
    }
  }, 5000);

  test('withLock releases the lock even when fn throws', () => {
    const { root, lp } = tmpLock();
    expect(() => withLock(root, lp, () => { throw new Error('boom'); })).toThrow('boom');
    expect(fs.existsSync(lp)).toBe(false); // released despite the throw
  });

  test('release() on an absent lock is a silent no-op', () => {
    const { lp } = tmpLock();
    expect(() => release(lp)).not.toThrow();
  });
});
