'use strict';

// Issue #150: pid liveness is not pid identity. A lock/pidfile left by a crashed
// daemon whose pid was later recycled by an unrelated process looked "live" to
// pidAlive and wedged every spawn for that workspace. pidIdentity classifies by
// command line; cleanStale cleans recycled ('other') pids and respects 'ours'
// and the safe 'unknown' default.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { cleanStale, startDaemon } = require('../../../src/device/session-daemon');
const { pidIdentity, isZombie } = require('../../../src/device/process-identity');
const paths = require('../../../src/device/session-paths');
const { ensureSalt, readSalt } = require('../../../src/device/session-salt');

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

// #156: `session end` escalates to a process-group kill, so "a mauto daemon"
// is not enough — it has to be THIS workspace's daemon. A copied workspace
// (`cp -R` carries daemon.pid) or a recycled pid would otherwise name another
// workspace's live daemon.
describe('pidIdentity bound to a workspace (#156)', () => {
  const root = '/a/proj';
  // #236: the marker is salted per workspace; pidIdentity reads this
  // workspace's salt through the injected readSalt (fixedSalt here).
  const SALT = 'a'.repeat(64);
  const fixedSalt = () => SALT;
  const cmd = (r, salt = SALT) => `node /x/bin/mauto-session-daemon.js ${paths.daemonArgv(r, salt).join(' ')}\n`;

  test("a daemon whose command line names this workspace is ours", () => {
    expect(pidIdentity(process.ppid, { projectRoot: root, readSalt: fixedSalt, execFile: () => cmd(root) })).toBe('ours');
  });

  test("another workspace's daemon is foreign, not ours", () => {
    expect(pidIdentity(process.ppid, { projectRoot: root, readSalt: fixedSalt, execFile: () => cmd('/b/other') })).toBe('foreign');
  });

  // #237: a daemon started by mauto <= 0.27.x carries no marker of either kind.
  // It is not PROVEN foreign — it names no workspace at all — so it gets its
  // own answer and `session end` decides from the socket and the lock.
  test('a daemon line with no workspace marker (mauto <= 0.27.x, an editor on the bin) is unmarked (#237)', () => {
    const bare = () => 'node /x/bin/mauto-session-daemon.js\n';
    expect(pidIdentity(process.ppid, { projectRoot: root, readSalt: fixedSalt, execFile: bare })).toBe('unmarked');
    expect(pidIdentity(process.ppid, { projectRoot: root, readSalt: fixedSalt, execFile: () => 'vim bin/mauto-session-daemon.js' })).toBe('unmarked');
    // With no salt at all the answer is the same: there is no key to compare.
    expect(pidIdentity(process.ppid, { projectRoot: root, readSalt: () => null, execFile: bare })).toBe('unmarked');
  });

  test('an unmarked daemon is still ours without a projectRoot (cleanStale unchanged, #237)', () => {
    expect(pidIdentity(process.ppid, { execFile: () => 'node /x/bin/mauto-session-daemon.js' })).toBe('ours');
  });

  test('a marker naming another workspace stays foreign, never unmarked (#237)', () => {
    expect(pidIdentity(process.ppid, { projectRoot: root, readSalt: fixedSalt, execFile: () => cmd('/b/other') })).toBe('foreign');
    expect(
      pidIdentity(process.ppid, {
        projectRoot: root,
        readSalt: fixedSalt,
        execFile: () => 'node /x/bin/mauto-session-daemon.js --project-root /b/other\n',
      })
    ).toBe('foreign');
  });

  test("a daemon keyed with another workspace's salt is foreign: a cp -R'd workspace has a new root (#236)", () => {
    // The copy carries the salt AND daemon.pid, but the key is HMAC(salt, root),
    // so the original daemon's line never names the copy.
    expect(pidIdentity(process.ppid, { projectRoot: '/b/copy', readSalt: fixedSalt, execFile: () => cmd(root) })).toBe('foreign');
    expect(pidIdentity(process.ppid, { projectRoot: root, readSalt: () => 'b'.repeat(64), execFile: () => cmd(root) })).toBe('foreign');
  });

  test('a workspace with no readable salt cannot claim a keyed daemon (#236)', () => {
    expect(pidIdentity(process.ppid, { projectRoot: root, readSalt: () => null, execFile: () => cmd(root) })).toBe('foreign');
  });

  test('reads the salt of the workspace it was asked about', () => {
    let asked;
    pidIdentity(process.ppid, {
      projectRoot: root,
      readSalt: (r) => {
        asked = r;
        return SALT;
      },
      execFile: () => cmd(root),
    });
    expect(asked).toBe(root);
  });

  test('a legacy --project-root daemon (0.28.0-0.35.0) is still ours for its own root only (#236)', () => {
    const legacy = (r) => `node /x/bin/mauto-session-daemon.js --project-root ${r}\n`;
    expect(pidIdentity(process.ppid, { projectRoot: root, readSalt: fixedSalt, execFile: () => legacy(root) })).toBe('ours');
    expect(pidIdentity(process.ppid, { projectRoot: root, readSalt: fixedSalt, execFile: () => legacy('/b/other') })).toBe('foreign');
  });

  test('a process that is not a mauto daemon at all is still other', () => {
    expect(pidIdentity(process.ppid, { projectRoot: root, readSalt: fixedSalt, execFile: () => 'sleep 120' })).toBe('other');
  });

  test('without a projectRoot the binary-level answer is unchanged (cleanStale)', () => {
    expect(pidIdentity(process.ppid, { execFile: () => cmd('/b/other') })).toBe('ours');
  });

  test('asks ps for the full, untruncated command line', () => {
    let args;
    pidIdentity(process.ppid, {
      projectRoot: root,
      readSalt: fixedSalt,
      execFile: (_bin, a) => {
        args = a;
        return cmd(root);
      },
    });
    expect(args).toEqual(['-ww', '-p', String(process.ppid), '-o', 'command=']);
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

  test('cleaning stale files never deletes the marker salt (#236)', () => {
    const root = tmpRoot();
    const salt = ensureSalt(root);
    fs.writeFileSync(paths.lockPath(root), String(process.ppid) + '\n');
    fs.writeFileSync(paths.pidFilePath(root), '999999999\n');
    fs.writeFileSync(paths.handlePath(root), '{}');

    expect(cleanStale(root, { execFile: () => 'node /usr/bin/something-else' }).cleaned).toBe(true);
    expect(readSalt(root)).toBe(salt);
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

// #156: a daemon SIGTERMed during createCall has no handler installed yet, so it
// dies without its 'exit' cleanup and leaves its lock behind. The next start
// must treat that lock as stale (dead pid), not as a held lock.
describe('stale lock from a daemon killed mid-startup (#156)', () => {
  test('a lock left by a dead daemon does not block the next start', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-deadlock-'));
    fs.mkdirSync(paths.sessionDir(root), { recursive: true });
    const dead = require('child_process').spawnSync(process.execPath, ['-e', '']).pid;
    fs.writeFileSync(paths.lockPath(root), `${dead}\n`);

    const daemon = await startDaemon({
      projectRoot: root,
      createCall: async () => ({ call: async () => ({}), close: async () => {} }),
    });
    expect(fs.readFileSync(paths.lockPath(root), 'utf8').trim()).toBe(String(process.pid));
    await daemon.stop();
  });
});

// #156: kill(pid, 0) succeeds on a zombie, so where PID 1 never reaps adopted
// orphans (Docker without --init, CI job containers running `tail -f
// /dev/null`, a Node agent host as PID 1) a daemon that already exited looked
// alive and `session end` waited out its whole 35s budget.
describe('isZombie', () => {
  const linux = (stat) => ({ platform: 'linux', readFile: () => stat });

  test('linux: state Z (or X) in /proc/<pid>/stat is a zombie', () => {
    expect(isZombie(7, linux('7 (node) Z 1 7 7 0 -1'))).toBe(true);
    expect(isZombie(7, linux('7 (node) X 1 7 7 0 -1'))).toBe(true);
    expect(isZombie(7, linux('7 (node) S 1 7 7 0 -1'))).toBe(false);
  });

  test('linux: the state is read after the LAST ")" — a command name may contain one', () => {
    expect(isZombie(7, linux('7 (a) Z (b) S 1 7 7 0 -1'))).toBe(false);
    expect(isZombie(7, linux('7 (a) S (b) Z 1 7 7 0 -1'))).toBe(true);
  });

  test('linux: needs no ps — an unreadable /proc entry is simply not a zombie', () => {
    const readFile = () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    };
    expect(isZombie(7, { platform: 'linux', readFile })).toBe(false);
  });

  test('elsewhere: asks ps for the state', () => {
    let args;
    const execFile = (_bin, a) => {
      args = a;
      return 'Z\n';
    };
    expect(isZombie(7, { platform: 'darwin', execFile })).toBe(true);
    expect(args).toEqual(['-o', 'stat=', '-p', '7']);
    expect(isZombie(7, { platform: 'darwin', execFile: () => 'Ss\n' })).toBe(false);
  });

  test('elsewhere: a failing ps is not a zombie (plain liveness decides)', () => {
    const execFile = () => {
      throw new Error('ps: not found');
    };
    expect(isZombie(7, { platform: 'darwin', execFile })).toBe(false);
  });
});
