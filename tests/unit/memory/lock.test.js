'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { acquire, release, withLock, STALE_MS } = require('../../../src/memory/lock');

function tmpLock() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-lock-'));
  return path.join(dir, '.session', 'memory.lock');
}

describe('memory/lock', () => {
  test('withLock runs fn and releases', () => {
    const lp = tmpLock();
    const out = withLock(lp, () => 42);
    expect(out).toBe(42);
    expect(fs.existsSync(lp)).toBe(false); // released
  });

  test('a held lock blocks a second acquire until it times out', () => {
    const lp = tmpLock();
    acquire(lp);
    let now = 1000;
    const clock = () => now;
    const sleep = () => { now += 100; }; // advance virtual time instead of real sleep
    expect(() => acquire(lp, { now: clock, sleep })).toThrow(/could not acquire/);
    release(lp);
  });

  test('a stale lock (older than STALE_MS) is broken and re-acquired', () => {
    const lp = tmpLock();
    acquire(lp);
    // Backdate the lockfile mtime beyond the stale window.
    const past = new Date(Date.now() - STALE_MS - 1000);
    fs.utimesSync(lp, past, past);
    // A fresh acquire should break it and succeed.
    expect(() => acquire(lp)).not.toThrow();
    release(lp);
  });
});
