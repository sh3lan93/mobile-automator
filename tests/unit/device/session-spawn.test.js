'use strict';

const { EventEmitter } = require('events');

const { spawnDaemon, DAEMON_BIN } = require('../../../src/device/session-spawn');

function fakeChild(pid = 4242) {
  return { pid, unref() { this.unrefed = true; }, unrefed: false };
}

// Stands in for session-log's handle: records what the spawn site writes and
// whether it released its dup of the fd.
function fakeLog(fd = 55) {
  return {
    fd,
    path: '/proj/mobile-automator/.session/daemon.log',
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
    const log = fakeLog(55);
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
    // Drift guard for #163: stdout AND stderr must reach the log fd, or the
    // daemon's crash traces (and mobile-mcp's inherited stderr) go to /dev/null.
    expect(captured.opts.stdio).toEqual(['ignore', 55, 55]);
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

  test('writes one banner line naming the child pid, then releases its fd', async () => {
    const log = fakeLog();
    await spawnDaemon({
      projectRoot: '/proj',
      spawn: () => fakeChild(9001),
      openLog: () => log,
      isAlive: async () => true,
      pollMs: 1,
    });
    expect(log.writes).toHaveLength(1);
    // Leading newline + a delimiter line keeps interleaved spawns separable.
    expect(log.writes[0]).toMatch(
      /^\n=== mauto daemon spawn \d{4}-\d{2}-\d{2}T[\d:.]+Z child_pid=9001 ===\n$/,
    );
    // The child holds its own dup; the parent must not leak this one.
    expect(log.closes).toBe(1);
  });

  test('a child with no pid still gets a banner', async () => {
    const log = fakeLog();
    const ok = await spawnDaemon({
      projectRoot: '/proj',
      spawn: () => ({ unref() {} }),
      openLog: () => log,
      isAlive: async () => true,
      pollMs: 1,
    });
    expect(ok).toBe(true);
    expect(log.writes[0]).toContain('child_pid=?');
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

  test('falls back to stdio ignore when the log cannot be opened', async () => {
    let captured = null;
    const ok = await spawnDaemon({
      projectRoot: '/proj',
      spawn: (cmd, args, opts) => { captured = opts; return fakeChild(); },
      openLog: () => null, // read-only workspace
      isAlive: async () => true,
      pollMs: 1,
    });
    expect(ok).toBe(true);
    expect(captured.stdio).toBe('ignore');
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
});
