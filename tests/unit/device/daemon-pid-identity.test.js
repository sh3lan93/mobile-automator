'use strict';

// Issue #150: pid liveness is not pid identity. A lock/pidfile left by a crashed
// daemon whose pid was later recycled by an unrelated process looked "live" to
// pidAlive and wedged every spawn for that workspace. pidIdentity classifies by
// command line; cleanStale cleans recycled ('other') pids and respects 'ours'
// and the safe 'unknown' default.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { pidIdentity, cleanStale } = require('../../../src/device/session-daemon');
const paths = require('../../../src/device/session-paths');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-pid-'));
}

describe('pidIdentity (#150)', () => {
  test('a dead pid is classified dead', () => {
    expect(pidIdentity(999999999)).toBe('dead');
  });

  test('an alive pid whose command contains mauto-session-daemon is ours', () => {
    const execFile = () => 'node /path/to/mauto-session-daemon.js';
    expect(pidIdentity(process.ppid, { execFile })).toBe('ours');
  });

  test('an alive pid whose command does not contain it is other (recycled)', () => {
    const execFile = () => 'node /usr/bin/something-else';
    expect(pidIdentity(process.ppid, { execFile })).toBe('other');
  });

  test('an alive pid whose ps lookup fails is unknown (safe default, never crash)', () => {
    const execFile = () => {
      throw new Error('ENOENT: no ps on this host');
    };
    expect(pidIdentity(process.ppid, { execFile })).toBe('unknown');
  });
});

describe('cleanStale with pid identity (#150)', () => {
  test('a lockfile pointing at a recycled (other) pid is cleaned — wedge cleared', () => {
    const root = tmpRoot();
    fs.mkdirSync(paths.sessionDir(root), { recursive: true });
    fs.writeFileSync(paths.lockPath(root), String(process.ppid) + '\n');
    fs.writeFileSync(paths.pidFilePath(root), '999999999\n');
    fs.writeFileSync(paths.socketPath(root), 'stale');
    fs.writeFileSync(paths.handlePath(root), '{}');

    const r = cleanStale(root, { execFile: () => 'node /usr/bin/something-else' });
    expect(r.cleaned).toBe(true);
    expect(fs.existsSync(paths.socketPath(root))).toBe(false);
    expect(fs.existsSync(paths.lockPath(root))).toBe(false);
    expect(fs.existsSync(paths.pidFilePath(root))).toBe(false);
  });

  test('a lockfile pointing at an ours pid is respected', () => {
    const root = tmpRoot();
    fs.mkdirSync(paths.sessionDir(root), { recursive: true });
    fs.writeFileSync(paths.lockPath(root), String(process.ppid) + '\n');
    fs.writeFileSync(paths.socketPath(root), 'stale');

    const r = cleanStale(root, { execFile: () => 'node /path/to/mauto-session-daemon.js' });
    expect(r.cleaned).toBe(false);
    expect(r.livePid).toBe(process.ppid);
    expect(fs.existsSync(paths.socketPath(root))).toBe(true); // untouched
  });

  test('a lockfile pointing at an unknown pid is respected (never clean when unsure)', () => {
    const root = tmpRoot();
    fs.mkdirSync(paths.sessionDir(root), { recursive: true });
    fs.writeFileSync(paths.lockPath(root), String(process.ppid) + '\n');
    fs.writeFileSync(paths.socketPath(root), 'stale');

    const r = cleanStale(root, {
      execFile: () => {
        throw new Error('ENOENT');
      },
    });
    expect(r.cleaned).toBe(false);
    expect(r.livePid).toBe(process.ppid);
    expect(fs.existsSync(paths.socketPath(root))).toBe(true);
  });
});