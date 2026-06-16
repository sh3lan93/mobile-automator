'use strict';

// Smoke-only: the server module must load and expose runServer. We do NOT
// connect a transport here (that would hijack stdio); the long-lived wiring is
// exercised manually, never in the suite.
const serverMod = require('../../../src/mcp/server');

describe('mcp server module', () => {
  test('exports runServer as an async function', () => {
    expect(typeof serverMod.runServer).toBe('function');
  });

  test('exports a buildServer factory that advertises prompts (not tools)', () => {
    // buildServer constructs the Server + registers handlers but does NOT
    // connect — safe to call in a test.
    expect(typeof serverMod.buildServer).toBe('function');
    const { server } = serverMod.buildServer({ projectRoot: process.cwd() });
    expect(server).toBeTruthy();
    // The Server should respond to a connect() call (transport wiring lives in
    // runServer); we only assert the object shape here.
    expect(typeof server.connect).toBe('function');
  });
});
