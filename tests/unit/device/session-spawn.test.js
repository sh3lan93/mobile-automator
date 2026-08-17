'use strict';

const { EventEmitter } = require('events');

const { spawnDaemon, DAEMON_BIN } = require('../../../src/device/session-spawn');

function fakeChild() {
  return { unref() { this.unrefed = true; }, unrefed: false };
}

describe('session-spawn', () => {
  test('spawns the daemon bin detached + unref, passing project root via env', async () => {
    let captured = null;
    const child = fakeChild();
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
      isAlive: async () => true,
      pollMs: 1,
    });
    expect(ok).toBe(true);
    expect(captured.cmd).toBe(process.execPath);
    expect(captured.args).toEqual([DAEMON_BIN]);
    expect(captured.opts.detached).toBe(true);
    expect(captured.opts.stdio).toBe('ignore');
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
