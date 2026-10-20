'use strict';

// The server module must load and expose runServer. We never connect the stdio
// transport here (that would hijack stdio) — runServer's long-lived wiring is
// exercised manually; the capability test below uses an in-memory pair instead.
const serverMod = require('../../../src/mcp/server');

describe('mcp server module', () => {
  test('exports runServer as an async function', () => {
    expect(typeof serverMod.runServer).toBe('function');
  });

  test('exports a buildServer factory that builds a connectable server', () => {
    // buildServer constructs the Server + registers handlers but does NOT
    // connect — safe to call in a test.
    expect(typeof serverMod.buildServer).toBe('function');
    const { server } = serverMod.buildServer({ projectRoot: process.cwd() });
    expect(server).toBeTruthy();
    // The Server should respond to a connect() call (transport wiring lives in
    // runServer); we only assert the object shape here.
    expect(typeof server.connect).toBe('function');
  });

  // Load-bearing for #212: mauto runs its engine with MOBILEMCP_ALLOW_UNSAFE_URLS=1
  // because the device is reachable only through `mauto` verbs, which need a
  // shell. Exposing device tools over `mauto mcp` would let an MCP-only client
  // open arbitrary URL schemes — revisit buildEngineEnv before changing this.
  // Asserted over the protocol (a real client handshake), not the Server's
  // private state, because the handshake is what an MCP client actually sees.
  test('advertises the prompts capability and no tools over a real handshake (#212)', async () => {
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
    const { server } = serverMod.buildServer({ projectRoot: process.cwd() });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'mauto-server-test', version: '0.0.0' }, { capabilities: {} });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const caps = client.getServerCapabilities();
      expect(caps).toHaveProperty('prompts');
      expect(caps).not.toHaveProperty('tools');
      await expect(client.listTools()).rejects.toThrow();
    } finally {
      await client.close();
    }
  });
});
