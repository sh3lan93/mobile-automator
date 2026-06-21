'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { startDaemon, cleanStale } = require('../../../src/device/session-daemon');
const sessionClient = require('../../../src/device/session-client');
const paths = require('../../../src/device/session-paths');

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

  test('writes handle + pidfile on listen and removes them on stop', async () => {
    const root = tmpRoot();
    const { createCall } = makeFakeCreateCall();
    const daemon = await startDaemon({ projectRoot: root, device: 'emulator-5554', idleMs: 0, createCall });

    expect(fs.existsSync(paths.handlePath(root))).toBe(true);
    expect(fs.existsSync(paths.pidFilePath(root))).toBe(true);
    const handle = JSON.parse(fs.readFileSync(paths.handlePath(root), 'utf8'));
    expect(handle.device).toBe('emulator-5554');
    expect(handle.pid).toBe(process.pid);

    await daemon.stop();
    expect(fs.existsSync(paths.handlePath(root))).toBe(false);
    expect(fs.existsSync(paths.pidFilePath(root))).toBe(false);
    expect(fs.existsSync(paths.socketPath(root))).toBe(false);
  });

  test('idle timeout reaps the daemon', async () => {
    const root = tmpRoot();
    const { createCall, state } = makeFakeCreateCall();
    const daemon = await startDaemon({ projectRoot: root, idleMs: 50, createCall });

    await daemon.whenStopped;
    expect(state.closed).toBe(1);
    expect(fs.existsSync(paths.socketPath(root))).toBe(false);
  });

  test('idle timer resets on each request', async () => {
    const root = tmpRoot();
    const { createCall } = makeFakeCreateCall();
    const daemon = await startDaemon({ projectRoot: root, idleMs: 120, createCall });

    // Keep it alive past the original idle window with periodic pings.
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 60));
      const conn = await sessionClient.tryConnect(root);
      await conn.call('ping_tool', {});
      await conn.close();
    }
    expect(await sessionClient.isAlive(root)).toBe(true);
    await daemon.stop();
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
