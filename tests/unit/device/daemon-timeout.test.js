'use strict';

// Issue #149: the daemon must bound every shared-connection call with a per-call
// timeout BELOW the client's 30s, so a hung mobile-mcp call surfaces as an
// honest {kind:'timeout'} reply instead of being dropped by the client's own
// timeout (which reads as a false-failure → retry → double-execution). Also
// covers the `stopping` guard (a call that never started must not block stop()'s
// drain) and the `in_flight` surface on ping.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { startDaemon, DAEMON_CALL_TIMEOUT_MS } = require('../../../src/device/session-daemon');
const sessionClient = require('../../../src/device/session-client');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-timeout-'));
}

// A createCall whose `call` hangs until the test resolves it.
function hangingCreateCall() {
  const resolvers = [];
  return {
    createCall: async () => ({
      call: async () => new Promise((r) => resolvers.push(r)),
      close: async () => {},
    }),
    resolvers,
  };
}

describe('session-daemon per-call timeout (#149)', () => {
  test('a call that never resolves is bounded by DAEMON_CALL_TIMEOUT_MS with kind:timeout + verify-state hint', async () => {
    const root = tmpRoot();
    const { createCall } = hangingCreateCall();
    const daemon = await startDaemon({
      projectRoot: root,
      idleMs: 0,
      createCall,
      // Resolves immediately → the timeout always wins the race.
      scheduleTimeout: async () => {},
    });

    const conn = await sessionClient.tryConnect(root);
    let err = null;
    try {
      await conn.call('mobile_press_button', { button: 'BACK' });
    } catch (e) {
      err = e;
    }
    expect(err).not.toBeNull();
    expect(err.kind).toBe('timeout');
    expect(err.message).toMatch(new RegExp(`did not respond within ${DAEMON_CALL_TIMEOUT_MS}ms`));
    expect(err.hint).toMatch(/verify state/);

    // in_flight returned to 0 after the timeout reply went out.
    expect(await sessionClient.getSessionStatus(root)).toEqual({ running: true, in_flight: 0, device: null });

    await conn.close();
    await daemon.stop();
  });

  test('a rejecting (non-timeout) call replies with message only — no kind, defaults to device', async () => {
    const root = tmpRoot();
    const createCall = async () => ({
      call: async () => {
        throw new Error('forced device error');
      },
      close: async () => {},
    });
    const daemon = await startDaemon({
      projectRoot: root,
      idleMs: 0,
      createCall,
      // Never resolves → the rejection wins the race, not the timeout.
      scheduleTimeout: () => new Promise(() => {}),
    });

    const conn = await sessionClient.tryConnect(root);
    let err = null;
    try {
      await conn.call('mobile_press_button', {});
    } catch (e) {
      err = e;
    }
    expect(err).not.toBeNull();
    expect(err.message).toBe('forced device error');
    expect(err.kind).toBeUndefined();
    expect(err.hint).toBeUndefined();

    expect(await sessionClient.getSessionStatus(root)).toEqual({ running: true, in_flight: 0, device: null });

    await conn.close();
    await daemon.stop();
  });

  test('stopping guard: a call frame after stop() began is rejected without incrementing in_flight', async () => {
    const root = tmpRoot();
    const { createCall, resolvers } = hangingCreateCall();
    const daemon = await startDaemon({
      projectRoot: root,
      idleMs: 0,
      createCall,
      scheduleTimeout: () => new Promise(() => {}),
    });

    // One hanging call keeps stop()'s drain blocked (server still listening).
    const connA = await sessionClient.tryConnect(root);
    const callP = connA.call('hang', {});
    await new Promise((r) => setTimeout(r, 20));

    const stopP = daemon.stop(); // stopping=true synchronously; drain waits on inFlight=1

    // A NEW connection's call frame must be rejected up front.
    const connB = await sessionClient.tryConnect(root);
    let err = null;
    try {
      await connB.call('late', {});
    } catch (e) {
      err = e;
    }
    expect(err).not.toBeNull();
    expect(err.message).toMatch(/shutting down/);

    // in_flight is still 1 — the rejected call never incremented it.
    expect(await sessionClient.getSessionStatus(root)).toEqual({ running: true, in_flight: 1, device: null });

    // Release the hanging call so stop()'s drain completes.
    resolvers[0]({ done: true });
    await callP;
    await stopP;

    await connA.close();
    await connB.close();
  });

  test('ping reports in_flight reflecting outstanding calls', async () => {
    const root = tmpRoot();
    const { createCall, resolvers } = hangingCreateCall();
    const daemon = await startDaemon({
      projectRoot: root,
      idleMs: 0,
      createCall,
      scheduleTimeout: () => new Promise(() => {}),
    });

    // Two calls in flight on separate connections (frames on one socket are
    // handled sequentially, so concurrency needs two sockets).
    const connA = await sessionClient.tryConnect(root);
    const connB = await sessionClient.tryConnect(root);
    const pA = connA.call('a', {});
    const pB = connB.call('b', {});
    await new Promise((r) => setTimeout(r, 20));

    expect(await sessionClient.getSessionStatus(root)).toEqual({ running: true, in_flight: 2, device: null });

    resolvers[0]({ done: 'a' });
    resolvers[1]({ done: 'b' });
    await Promise.all([pA, pB]);

    expect(await sessionClient.getSessionStatus(root)).toEqual({ running: true, in_flight: 0, device: null });

    await connA.close();
    await connB.close();
    await daemon.stop();
  });
});