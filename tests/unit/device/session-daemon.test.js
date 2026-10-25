'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { startDaemon, cleanStale } = require('../../../src/device/session-daemon');
const sessionClient = require('../../../src/device/session-client');
const paths = require('../../../src/device/session-paths');
const { ensureSalt, readSalt } = require('../../../src/device/session-salt');

// Captured before any test fakes the clock, so a bounded wait still expires.
const realSetTimeout = setTimeout;
const realClearTimeout = clearTimeout;

// Reject instead of hanging: an unresolved promise in a fake-timer test never
// reaches its `finally`, and the daemon it leaves listening keeps jest alive.
function within(promise, ms, what) {
  let timer;
  const expiry = new Promise((_, reject) => {
    timer = realSetTimeout(() => reject(new Error(`${what} within ${ms}ms`)), ms);
  });
  return Promise.race([promise, expiry]).finally(() => realClearTimeout(timer));
}

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-daemon-'));
}

// Fake createCall: records how many times it builds a connection (must be 1)
// and how many tool calls each connection serves.
function makeFakeCreateCall() {
  const state = { builds: 0, calls: [], closed: 0 };
  const createCall = async ({ device } = {}) => {
    state.builds += 1;
    state.device = device || null;
    return {
      call: async (tool, args) => {
        state.calls.push({ tool, args });
        return { echoed: tool, args };
      },
      close: async () => {
        state.closed += 1;
      },
    };
  };
  return { createCall, state };
}

describe('session-daemon', () => {
  test('serves a request via the fake connection', async () => {
    const root = tmpRoot();
    const { createCall, state } = makeFakeCreateCall();
    const daemon = await startDaemon({ root, projectRoot: root, idleMs: 0, createCall });

    const conn = await sessionClient.tryConnect(root);
    const res = await conn.call('mobile_press_button', { button: 'BACK' });
    expect(res).toEqual({ echoed: 'mobile_press_button', args: { button: 'BACK' } });
    expect(state.calls).toHaveLength(1);

    await conn.close();
    await daemon.stop();
  });

  test('single-connection invariant: N calls across M clients build exactly one connection', async () => {
    const root = tmpRoot();
    const { createCall, state } = makeFakeCreateCall();
    const daemon = await startDaemon({ projectRoot: root, idleMs: 0, createCall });

    for (let i = 0; i < 5; i++) {
      const conn = await sessionClient.tryConnect(root);
      await conn.call('mobile_list_elements_on_screen', {});
      await conn.close();
    }

    expect(state.builds).toBe(1);
    expect(state.calls).toHaveLength(5);

    await daemon.stop();
  });

  // #251: the engine is recorded in the handle exactly like the device pin, so
  // a verb resolving a different engine can tell the live daemon is stale.
  test('passes engine to createCall and records engine + engine_source in the handle', async () => {
    const root = tmpRoot();
    let seen = null;
    const createCall = async (opts) => {
      seen = opts;
      return { call: async () => ({}), close: async () => {} };
    };
    const daemon = await startDaemon({
      projectRoot: root,
      engine: 'legacy',
      engineSource: 'config',
      idleMs: 0,
      createCall,
    });
    expect(seen.engine).toBe('legacy');
    // #236: the engine runs from the root so its argv can be root-relative.
    expect(seen.projectRoot).toBe(root);
    const handle = JSON.parse(fs.readFileSync(paths.handlePath(root), 'utf8'));
    expect(handle.engine).toBe('legacy');
    expect(handle.engine_source).toBe('config');
    await daemon.stop();
  });

  test('writes handle + pidfile on listen and removes them on stop', async () => {
    const root = tmpRoot();
    const { createCall } = makeFakeCreateCall();
    const daemon = await startDaemon({ projectRoot: root, device: 'emulator-5554', idleMs: 0, createCall });

    expect(fs.existsSync(paths.handlePath(root))).toBe(true);
    expect(fs.existsSync(paths.pidFilePath(root))).toBe(true);
    const handle = JSON.parse(fs.readFileSync(paths.handlePath(root), 'utf8'));
    expect(handle.device).toBe('emulator-5554');
    expect(handle.pid).toBe(process.pid);
    // No engine given: the default robot, source unknown to the daemon.
    expect(handle.engine).toBe('mobilecli');
    expect(handle.engine_source).toBeNull();

    await daemon.stop();
    expect(fs.existsSync(paths.handlePath(root))).toBe(false);
    expect(fs.existsSync(paths.pidFilePath(root))).toBe(false);
    expect(fs.existsSync(paths.socketPath(root))).toBe(false);
  });

  test('stop never deletes the marker salt: it is created once, never rotated (#236)', async () => {
    const root = tmpRoot();
    const salt = ensureSalt(root);
    const { createCall } = makeFakeCreateCall();
    const daemon = await startDaemon({ projectRoot: root, idleMs: 0, createCall });
    await daemon.stop();
    expect(readSalt(root)).toBe(salt);
  });

  test('idle timeout reaps the daemon', async () => {
    const root = tmpRoot();
    const { createCall, state } = makeFakeCreateCall();
    const daemon = await startDaemon({ projectRoot: root, idleMs: 50, createCall });

    await daemon.whenStopped;
    expect(state.closed).toBe(1);
    expect(fs.existsSync(paths.socketPath(root))).toBe(false);
  });

  // Fake clock, not real sleeps: with real time, any event-loop stall longer
  // than the gap between idleMs and the ping interval (GC, a loaded jest
  // worker) let the timer fire mid-test and fail it as "session daemon
  // connection closed". Socket I/O is not a timer, so it still runs for real.
  test('idle timer resets on each request', async () => {
    jest.useFakeTimers();
    const root = tmpRoot();
    const { createCall, state } = makeFakeCreateCall();
    const idleMs = 1000;
    const daemon = await startDaemon({ projectRoot: root, idleMs, createCall });
    try {
      // Three pings, each just inside the idle window, keep it alive well past
      // the original one — only possible if every request re-arms the timer.
      for (let i = 0; i < 3; i++) {
        await jest.advanceTimersByTimeAsync(idleMs - 1);
        const conn = await sessionClient.tryConnect(root);
        await conn.call('ping_tool', {});
        await conn.close();
      }
      expect(await sessionClient.isAlive(root)).toBe(true);

      // And the timer is still armed: it reaps exactly idleMs after the last
      // request, so a daemon that never idles cannot pass this test.
      await jest.advanceTimersByTimeAsync(idleMs - 1);
      expect(state.closed).toBe(0);
      await jest.advanceTimersByTimeAsync(1);
      await within(daemon.whenStopped, 2000, 'expected the idle timer to reap the daemon');
      expect(state.closed).toBe(1);
    } finally {
      jest.useRealTimers();
      await daemon.stop();
    }
  });

  test('cleanStale removes a stale socket/pidfile so a fresh daemon can bind', async () => {
    const root = tmpRoot();
    fs.mkdirSync(paths.sessionDir(root), { recursive: true });
    // Write a pidfile pointing at a definitely-dead pid + a leftover socket file.
    fs.writeFileSync(paths.pidFilePath(root), '999999999\n');
    fs.writeFileSync(paths.socketPath(root), 'stale');
    fs.writeFileSync(paths.handlePath(root), '{}');

    const r = cleanStale(root);
    expect(r.cleaned).toBe(true);
    expect(fs.existsSync(paths.socketPath(root))).toBe(false);
    expect(fs.existsSync(paths.pidFilePath(root))).toBe(false);

    // And a fresh daemon binds cleanly afterwards.
    const { createCall } = makeFakeCreateCall();
    const daemon = await startDaemon({ projectRoot: root, idleMs: 0, createCall });
    expect(await sessionClient.isAlive(root)).toBe(true);
    await daemon.stop();
  });

  test('startDaemon reaps its own stale leftovers before binding', async () => {
    const root = tmpRoot();
    fs.mkdirSync(paths.sessionDir(root), { recursive: true });
    fs.writeFileSync(paths.pidFilePath(root), '999999999\n');
    fs.writeFileSync(paths.socketPath(root), 'stale');

    const { createCall } = makeFakeCreateCall();
    const daemon = await startDaemon({ projectRoot: root, idleMs: 0, createCall });
    expect(await sessionClient.isAlive(root)).toBe(true);
    await daemon.stop();
  });

  test('shutdown control frame stops the daemon', async () => {
    const root = tmpRoot();
    const { createCall, state } = makeFakeCreateCall();
    const daemon = await startDaemon({ projectRoot: root, idleMs: 0, createCall });

    const acked = await sessionClient.requestShutdown(root);
    expect(acked).toBe(true);
    await daemon.whenStopped;
    expect(state.closed).toBe(1);
    expect(fs.existsSync(paths.socketPath(root))).toBe(false);
  });
});
