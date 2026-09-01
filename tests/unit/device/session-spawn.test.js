'use strict';

const { EventEmitter } = require('events');

const { spawnDaemon, DAEMON_BIN } = require('../../../src/device/session-spawn');
const { IGNORED } = require('../../../src/device/session-log');

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

describe('session-spawn', () => {
  test('spawns the daemon bin detached + unref, passing project root via env', async () => {
    let captured = null;
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
      isAlive: async () => true,
      pollMs: 1,
    });
    expect(ok).toBe(true);
    expect(captured.cmd).toBe(process.execPath);
    expect(captured.args).toEqual([DAEMON_BIN]);
    expect(captured.opts.detached).toBe(true);
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
});
