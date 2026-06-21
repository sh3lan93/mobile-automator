'use strict';

// Smoke test only — must NOT spawn a daemon. require.main !== module here, so
// loading the entrypoint has no side effects.
const mod = require('../../../bin/mauto-session-daemon');
const daemonMod = require('../../../src/device/session-daemon');

describe('bin/mauto-session-daemon (smoke)', () => {
  test('module loads and exports main without spawning', () => {
    expect(typeof mod.main).toBe('function');
  });

  test('wires startDaemon from session-daemon', () => {
    expect(typeof daemonMod.startDaemon).toBe('function');
  });
});
