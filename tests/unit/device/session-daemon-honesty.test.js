'use strict';

// Integration-style coverage for the session daemon's transport honesty and
// lifecycle guarantees (issue #122). These exercise the REAL socket / idle /
// stop / lock paths against a STUB mobile-mcp `createCall` injected through the
// existing seam — the stub has knobs (per-call delay, forced error, circular
// result, hang-on-init) so we can drive the failure modes the old fake never
// could. No real mobile-mcp is ever spawned.

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const { startDaemon } = require('../../../src/device/session-daemon');
const sessionClient = require('../../../src/device/session-client');
const paths = require('../../../src/device/session-paths');
const { encodeRequest } = require('../../../src/device/session-protocol');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-honesty-'));
}

// Stub mobile-mcp connection with failure/timing knobs.
function makeStubCreateCall({ delayMs = 0, fail = false, circular = false, hangInit = false } = {}) {
  const state = { builds: 0, calls: [], closed: 0 };
  const createCall = async ({ device } = {}) => {
    state.builds += 1;
    state.device = device || null;
    if (hangInit) {
      // Never resolves: simulates a mobile-mcp that hangs during init.
      await new Promise(() => {});
    }
    return {
      call: async (tool, args) => {
        state.calls.push({ tool, args });
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        if (fail) throw new Error('forced device error');
        if (circular) {
          const obj = { tool };
          obj.self = obj; // JSON.stringify will throw on this
          return obj;
        }
        return { echoed: tool, args };
      },
      close: async () => {
        state.closed += 1;
      },
    };
  };
  return { createCall, state };
}

describe('session-daemon honesty + lifecycle (#122)', () => {
  // A2: a device call slower than the idle window must still get its reply.
  test('slow call + short idle: reply still arrives (idle does not fire mid-call)', async () => {
    const root = tmpRoot();
    const { createCall, state } = makeStubCreateCall({ delayMs: 120 });
    const daemon = await startDaemon({ projectRoot: root, idleMs: 40, createCall });

    const conn = await sessionClient.tryConnect(root);
    const res = await conn.call('mobile_press_button', { button: 'BACK' });
    expect(res).toEqual({ echoed: 'mobile_press_button', args: { button: 'BACK' } });
    expect(state.calls).toHaveLength(1);

    await conn.close();
    await daemon.stop();
  });

  // A1: a successful call whose result cannot be serialized must NOT drop the
  // reply (which would hang the client to a 30s false-failure). It must send an
  // explicit ok:false frame instead.
  test('non-serializable result becomes an explicit ok:false frame, never a dropped reply', async () => {
    const root = tmpRoot();
    const { createCall } = makeStubCreateCall({ circular: true });
    const daemon = await startDaemon({ projectRoot: root, idleMs: 0, createCall });

    const conn = await sessionClient.tryConnect(root);
    await expect(conn.call('mobile_take_screenshot', {})).rejects.toThrow(/serializ/i);

    await conn.close();
    await daemon.stop();
  });

  // A1: client destroys its socket mid-call. The side effect already hit the
  // device, so the daemon must (a) not crash and (b) surface the undeliverable
  // reply rather than swallowing it.
  test('client socket destroyed mid-call: daemon survives and surfaces undeliverable', async () => {
    const root = tmpRoot();
    const { createCall, state } = makeStubCreateCall({ delayMs: 100 });
    const daemon = await startDaemon({ projectRoot: root, idleMs: 0, createCall });

    const socket = net.createConnection(paths.socketPath(root));
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    socket.write(encodeRequest({ id: 1, type: 'call', tool: 'mobile_press_button', args: { button: 'BACK' } }));
    // Destroy the socket while the (delayed) call is still in flight.
    await new Promise((r) => setTimeout(r, 20));
    socket.destroy();

    // Wait past the call delay so the daemon attempts (and fails) the reply.
    await new Promise((r) => setTimeout(r, 200));

    expect(state.calls).toHaveLength(1); // the call really executed
    expect(daemon.undeliverable.length).toBeGreaterThanOrEqual(1);
    // Daemon is still healthy and serving.
    expect(await sessionClient.isAlive(root)).toBe(true);

    await daemon.stop();
  });

  // C2/B2: two spawns for one workspace — exactly one binds; the loser fails the
  // lock and exits BEFORE it ever builds a mobile-mcp connection (no orphan child).
  test('double spawn / one root: exactly one binds; the loser spawns no child', async () => {
    const root = tmpRoot();
    const { createCall, state } = makeStubCreateCall();
    const daemon = await startDaemon({ projectRoot: root, idleMs: 0, createCall });
    expect(state.builds).toBe(1);

    // The loser re-uses the SAME stub createCall so we can assert it is never
    // invoked a second time (i.e. no child is spawned).
    await expect(
      startDaemon({ projectRoot: root, idleMs: 0, createCall })
    ).rejects.toThrow();
    expect(state.builds).toBe(1); // loser never built a second connection

    await daemon.stop();
    // Lock is released on stop, so a fresh daemon can start afterwards.
    const again = await startDaemon({ projectRoot: root, idleMs: 0, createCall });
    expect(state.builds).toBe(2);
    await again.stop();
  });

  // B2: listen failure (port already bound) must not leak the mobile-mcp child —
  // close() runs via try/finally and the lock is released.
  test('listen failure releases the lock and closes the connection (no orphan)', async () => {
    const root = tmpRoot();
    // Pre-bind the socket path so the daemon's listen() fails with EADDRINUSE.
    // Write a LIVE pidfile (this test process) so cleanStale treats the session
    // as live and does NOT unlink the blocker's socket — the daemon then gets
    // past the (absent) lock to the failing listen, exercising the close() path.
    fs.mkdirSync(paths.sessionDir(root), { recursive: true });
    fs.writeFileSync(paths.pidFilePath(root), String(process.pid) + '\n');
    const blocker = net.createServer();
    const socketPath = paths.socketPath(root);
    await new Promise((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(socketPath, resolve);
    });

    const { createCall, state } = makeStubCreateCall();
    await expect(
      startDaemon({ projectRoot: root, idleMs: 0, createCall })
    ).rejects.toThrow();
    // createCall ran (built the connection) but must have been closed on failure.
    expect(state.builds).toBe(1);
    expect(state.closed).toBe(1);
    // Lock released so a retry is possible.
    expect(fs.existsSync(paths.lockPath(root))).toBe(false);

    await new Promise((resolve) => blocker.close(resolve));
  });
});
