'use strict';

// Structural drift guard for issue #149: the daemon's per-call timeout must stay
// BELOW the client's request timeout so the daemon's timeout error always wins
// the race and reaches the client as an honest {kind:'timeout'} reply instead of
// being dropped by the client's own timeout (which would read as a false-failure
// and prompt a retry → double-execution).

const sessionClient = require('../../../src/device/session-client');
const sessionDaemon = require('../../../src/device/session-daemon');

describe('daemon/client timeout invariant (#149)', () => {
  test('CLIENT_TIMEOUT > DAEMON_CALL_TIMEOUT', () => {
    expect(sessionClient.DEFAULT_TIMEOUT_MS).toBeGreaterThan(sessionDaemon.DAEMON_CALL_TIMEOUT_MS);
  });
});

// #156: `session end` must outwait a daemon that is legitimately finishing —
// a drain bounded by the daemon call timeout, then the SDK's ~4s close ladder —
// before it concludes the daemon is stuck and escalates.
describe('session end budget invariant (#156)', () => {
  test('END_BUDGET > DAEMON_CALL_TIMEOUT + SDK close escalation', () => {
    const { END_BUDGET_MS } = require('../../../src/device/connection');
    expect(END_BUDGET_MS).toBeGreaterThan(sessionDaemon.DAEMON_CALL_TIMEOUT_MS + 4000);
  });
});

// #156: the spawner kills a daemon that is not ready when its window closes, so
// the engine connect bound must expire first — otherwise a slow-but-healthy
// connect is killed instead of failing honestly with daemon.connect_failure.
describe('connect/readiness timeout invariant (#156)', () => {
  test('CONNECT_TIMEOUT < DEFAULT_READY_TIMEOUT', () => {
    const { CONNECT_TIMEOUT_MS } = require('../../../src/device/mobile-mcp-client');
    const { DEFAULT_READY_TIMEOUT_MS } = require('../../../src/device/session-spawn');
    expect(CONNECT_TIMEOUT_MS).toBeLessThan(DEFAULT_READY_TIMEOUT_MS);
  });
});