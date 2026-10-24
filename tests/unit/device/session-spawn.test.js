'use strict';

const { EventEmitter } = require('events');

// The real ensureSalt writes <root>/mobile-automator/.session/marker.salt, and
// these tests spawn for a fake '/proj'. Its own behaviour is session-salt.test.js's.
jest.mock('../../../src/device/session-salt', () => ({
  ensureSalt: () => 'a'.repeat(64),
  readSalt: () => 'a'.repeat(64),
}));

const { spawnDaemon, DAEMON_BIN } = require('../../../src/device/session-spawn');
const { IGNORED } = require('../../../src/device/session-log');
const paths = require('../../../src/device/session-paths');

function fakeChild(pid = 4242) {
  return { pid, unref() { this.unrefed = true; }, unrefed: false };
}

// Stands in for session-log's handle: records what the spawn site writes and
// whether it released its dup of the fd. The stdio triple itself is session-log's
// decision (and is guarded in session-log.test.js) — here it is opaque, and the
// only thing that matters is that it reaches child_process.spawn unaltered.
function fakeLog(stdio = ['ignore', 55, 55]) {
  return {
    stdio,
    writes: [],
    closes: 0,
    write(text) { this.writes.push(text); },
    close() { this.closes += 1; },
  };
}

const SALT = 'a'.repeat(64);

describe('session-spawn', () => {
  test('a salt that cannot be written spawns the daemon with no marker, and says so (#236)', async () => {
    let captured = null;
    const log = fakeLog();
    const ok = await spawnDaemon({
      projectRoot: '/proj',
      spawn: (cmd, args, opts) => {
        captured = { cmd, args, opts };
        return fakeChild();
      },
      openLog: () => log,
      ensureSalt: () => {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      },
      isAlive: async () => true,
      pollMs: 1,
    });
    expect(ok).toBe(true);
    // No marker: `session end` then reports the daemon rather than group-kill
    // a process it cannot tie to this workspace.
    expect(captured.args).toEqual([paths.argvPath('/proj', DAEMON_BIN)]);
    expect(log.writes.join('')).toMatch(/marker salt/);
  });

  test('spawns the daemon bin detached + unref, passing project root via env', async () => {
    let captured = null;
    let saltRoot = null;
    const child = fakeChild();
    const log = fakeLog();
    const spawn = (cmd, args, opts) => {
      captured = { cmd, args, opts };
      return child;
    };
    // isAlive flips true immediately.
    const ok = await spawnDaemon({
      projectRoot: '/proj',
      device: 'emulator-5554',
      idleMs: 1234,
      spawn,
      openLog: () => log,
      ensureSalt: (root) => {
        saltRoot = root;
        return SALT;
      },
      isAlive: async () => true,
      pollMs: 1,
    });
    expect(ok).toBe(true);
    expect(saltRoot).toBe('/proj');
    expect(captured.cmd).toBe(process.execPath);
    // The workspace rides in argv as an identity marker `ps` can see (#156) —
    // by a digest salted with the workspace's own salt, never by path, and an in-project bin by its relative path
    // (#236): `ps` is visible to every user on the host. Env stays the
    // daemon's source of truth.
    expect(captured.args).toEqual([paths.argvPath('/proj', DAEMON_BIN), ...paths.daemonArgv('/proj', SALT)]);
    for (const arg of captured.args) expect(arg).not.toContain('/proj');
    expect(captured.opts.detached).toBe(true);
    // The engine inherits the daemon's cwd, and mobile-mcp only lets screenshots
    // land under its own cwd — so the daemon must run from the project root,
    // not from whichever subdirectory spawned it (#214).
    expect(captured.opts.cwd).toBe('/proj');
    // Pass-through, not re-derivation: whatever session-log decided is what the
    // child gets. The "fd 2 must be the log" guard for #163 lives in
    // session-log.test.js, where that decision is actually made.
    expect(captured.opts.stdio).toBe(log.stdio);
    expect(captured.opts.env.MAUTO_SESSION_PROJECT_ROOT).toBe('/proj');
    expect(captured.opts.env.MAUTO_SESSION_DEVICE).toBe('emulator-5554');
    expect(captured.opts.env.MAUTO_SESSION_IDLE_MS).toBe('1234');
    expect(child.unrefed).toBe(true);
  });

  test('resolves true once isAlive flips', async () => {
    let n = 0;
    const ok = await spawnDaemon({
      projectRoot: '/proj',
      spawn: () => fakeChild(),
      isAlive: async () => ++n >= 3,
      pollMs: 1,
      readyTimeoutMs: 1000,
    });
    expect(ok).toBe(true);
    expect(n).toBeGreaterThanOrEqual(3);
  });

  test('resolves false on readiness timeout', async () => {
    const ok = await spawnDaemon({
      projectRoot: '/proj',
      spawn: () => fakeChild(),
      isAlive: async () => false,
      pollMs: 5,
      readyTimeoutMs: 30,
    });
    expect(ok).toBe(false);
  });

  test('omits device env when no device pinned', async () => {
    let captured = null;
    await spawnDaemon({
      projectRoot: '/proj',
      spawn: (cmd, args, opts) => { captured = opts; return fakeChild(); },
      isAlive: async () => true,
      pollMs: 1,
    });
    expect(captured.env.MAUTO_SESSION_DEVICE).toBeUndefined();
  });

  // #251: the daemon records the engine it was spawned for in its handle, so a
  // verb resolving a different engine can tell the live daemon is stale.
  test('passes the resolved engine and its source via env', async () => {
    let captured = null;
    await spawnDaemon({
      projectRoot: '/proj',
      engine: 'legacy',
      engineSource: 'config',
      spawn: (cmd, args, opts) => { captured = opts; return fakeChild(); },
      isAlive: async () => true,
      pollMs: 1,
    });
    expect(captured.env.MAUTO_SESSION_ENGINE).toBe('legacy');
    expect(captured.env.MAUTO_SESSION_ENGINE_SOURCE).toBe('config');
  });

  test('omits engine env when no engine is given (the daemon resolves its own)', async () => {
    let captured = null;
    const saved = process.env.MAUTO_SESSION_ENGINE;
    process.env.MAUTO_SESSION_ENGINE = 'legacy'; // an inherited value must not leak through
    try {
      await spawnDaemon({
        projectRoot: '/proj',
        spawn: (cmd, args, opts) => { captured = opts; return fakeChild(); },
        isAlive: async () => true,
        pollMs: 1,
      });
    } finally {
      if (saved === undefined) delete process.env.MAUTO_SESSION_ENGINE;
      else process.env.MAUTO_SESSION_ENGINE = saved;
    }
    expect(captured.env.MAUTO_SESSION_ENGINE).toBeUndefined();
    expect(captured.env.MAUTO_SESSION_ENGINE_SOURCE).toBeUndefined();
  });

  test('opens the log with the project root, before the spawn', async () => {
    const order = [];
    let seenRoot = null;
    await spawnDaemon({
      projectRoot: '/proj',
      spawn: () => { order.push('spawn'); return fakeChild(); },
      openLog: (root) => { order.push('openLog'); seenRoot = root; return fakeLog(); },
      isAlive: async () => true,
      pollMs: 1,
    });
    // The fd has to exist before spawn can hand it to the child.
    expect(order).toEqual(['openLog', 'spawn']);
    expect(seenRoot).toBe('/proj');
  });

  test('releases the parent’s dup of the fd — one per verb invocation would leak', async () => {
    const log = fakeLog();
    await spawnDaemon({
      projectRoot: '/proj',
      spawn: () => fakeChild(),
      openLog: () => log,
      isAlive: async () => true,
      pollMs: 1,
    });
    expect(log.closes).toBe(1);
  });

  test('an unwritable workspace passes the degraded handle straight through', async () => {
    let captured = null;
    const ok = await spawnDaemon({
      projectRoot: '/proj',
      spawn: (cmd, args, opts) => { captured = opts; return fakeChild(); },
      openLog: () => IGNORED, // read-only workspace
      isAlive: async () => true,
      pollMs: 1,
    });
    expect(ok).toBe(true);
    expect(captured.stdio).toBe('ignore');
  });

  test('the fd is released even when spawn throws synchronously', async () => {
    const log = fakeLog();
    await expect(
      spawnDaemon({
        projectRoot: '/proj',
        spawn: () => { throw new Error('EINVAL: bad stdio'); },
        openLog: () => log,
        isAlive: async () => true,
        pollMs: 1,
      })
    ).rejects.toThrow('EINVAL: bad stdio');
    expect(log.closes).toBe(1);
  });

  test('a spawn error (EMFILE/EACCES) bails the readiness poll immediately', async () => {
    const child = new EventEmitter();
    child.unref = () => {};
    let polls = 0;
    const p = spawnDaemon({
      projectRoot: '/proj',
      spawn: () => child,
      isAlive: async () => {
        polls += 1;
        return false;
      },
      pollMs: 5,
      readyTimeoutMs: 10000,
    });
    // The 'error' listener is attached synchronously inside spawnDaemon, so an
    // error emitted right after the call is captured before the first poll
    // completes — no 10s wait for a child that can never come up.
    child.emit('error', new Error('spawn EMFILE'));
    const ok = await p;
    expect(ok).toBe(false);
    expect(polls).toBe(1); // bailed after the first poll, not ~2000
  });

  // #163, one layer up from the original fix: a child that never execs writes
  // NOTHING of its own, so the parent is the only witness to EMFILE/EACCES/
  // ENOENT-on-the-bin. Using the error purely as a bail-out flag — as this code
  // did — rebuilds the exact hole the log was added to close.
  test('a spawn error is written to the log, not just used as a bail-out flag', async () => {
    const child = new EventEmitter();
    child.unref = () => {};
    const log = fakeLog();
    const p = spawnDaemon({
      projectRoot: '/proj',
      spawn: () => child,
      openLog: () => log,
      isAlive: async () => false,
      pollMs: 5,
      readyTimeoutMs: 10000,
    });
    const err = new Error('spawn EACCES');
    child.emit('error', err);
    expect(await p).toBe(false);

    expect(log.writes).toHaveLength(1);
    expect(log.writes[0]).toContain('daemon spawn failed');
    expect(log.writes[0]).toContain('spawn EACCES');
    expect(log.writes[0]).toContain(err.stack.split('\n')[1].trim()); // a real frame
    // The handle has to outlive the poll: 'error' fires asynchronously, so
    // closing before the loop would silently drop the write above.
    expect(log.closes).toBe(1);
  });
  // #156: a running ChildProcess has exitCode === null AND signalCode === null.
  // The existing fakeChild() leaves both undefined, i.e. "not a live child".
  function liveChild(pid = 5151) {
    return { ...fakeChild(pid), exitCode: null, signalCode: null };
  }

  test('readiness timeout terminates the live child and logs it', async () => {
    const log = fakeLog();
    const terminated = [];
    const ok = await spawnDaemon({
      projectRoot: '/proj',
      spawn: () => liveChild(5151),
      openLog: () => log,
      isAlive: async () => false,
      terminate: async (pid) => { terminated.push(pid); return 'dead'; },
      pollMs: 5,
      readyTimeoutMs: 30,
    });
    expect(ok).toBe(false);
    expect(terminated).toEqual([5151]);
    expect(log.writes.join('')).toContain('daemon not ready after 30ms; terminated pid=5151 (dead)');
    expect(log.closes).toBe(1);
  });

  test('readiness timeout leaves an already-exited child alone (ELOCKED loser)', async () => {
    const terminated = [];
    const ok = await spawnDaemon({
      projectRoot: '/proj',
      spawn: () => ({ ...fakeChild(5152), exitCode: 1, signalCode: null }),
      openLog: () => fakeLog(),
      isAlive: async () => false,
      terminate: async (pid) => { terminated.push(pid); return 'dead'; },
      pollMs: 5,
      readyTimeoutMs: 30,
    });
    expect(ok).toBe(false);
    expect(terminated).toEqual([]);
  });

  test('a spawn error never terminates anything', async () => {
    const terminated = [];
    const child = Object.assign(new EventEmitter(), liveChild(5153));
    const ok = await spawnDaemon({
      projectRoot: '/proj',
      spawn: () => {
        setImmediate(() => child.emit('error', new Error('EACCES')));
        return child;
      },
      openLog: () => fakeLog(),
      isAlive: async () => false,
      terminate: async (pid) => { terminated.push(pid); return 'dead'; },
      pollMs: 5,
      readyTimeoutMs: 200,
    });
    expect(ok).toBe(false);
    expect(terminated).toEqual([]);
  });

  test('a ready daemon is never terminated', async () => {
    const terminated = [];
    const ok = await spawnDaemon({
      projectRoot: '/proj',
      spawn: () => liveChild(5154),
      openLog: () => fakeLog(),
      isAlive: async () => true,
      terminate: async (pid) => { terminated.push(pid); return 'dead'; },
      pollMs: 1,
    });
    expect(ok).toBe(true);
    expect(terminated).toEqual([]);
  });
});
