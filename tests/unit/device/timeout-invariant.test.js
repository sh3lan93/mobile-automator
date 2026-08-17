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