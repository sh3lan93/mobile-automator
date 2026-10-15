'use strict';

// createCall against the REAL MCP SDK and a fixture server. The unit tests use
// a fake SDK, which can only behave the way we believe the SDK behaves; this
// file is what shows the timeout option and onclose actually do that.

const path = require('path');
const { createCall } = require('../../src/device/mobile-mcp-client');

jest.setTimeout(15000);

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'mcp-fixture-server.js');
const server = (mode) => ({ command: process.execPath, args: [FIXTURE, mode] });

test('a server that never initializes fails with ENGINE_CONNECT_TIMEOUT, and is gone', async () => {
  const started = Date.now();
  const err = await createCall({ server: server('never-init'), connectTimeoutMs: 500 }).catch((e) => e);
  expect(err.code).toBe('ENGINE_CONNECT_TIMEOUT');
  // Bounded: the timeout plus the SDK's close ladder, never the 60s SDK default.
  expect(Date.now() - started).toBeLessThan(8000);
  // createCall only returns after reapEngine confirmed the child is dead; the
  // fixture ignores stdin EOF, so this proves the escalation really happened.
});

test('an engine that exits after initialize fires onEngineExit once', async () => {
  const exits = [];
  await createCall({ server: server('exit-after-init'), onEngineExit: () => exits.push(Date.now()) });
  const deadline = Date.now() + 5000;
  while (exits.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
  expect(exits).toHaveLength(1);
});

test('our own close() does not fire onEngineExit', async () => {
  const exits = [];
  const { close } = await createCall({ server: server('stay-up'), onEngineExit: () => exits.push(1) });
  await close();
  await new Promise((r) => setTimeout(r, 200));
  expect(exits).toHaveLength(0);
});
