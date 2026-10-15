#!/usr/bin/env node
'use strict';

// A minimal MCP server for tests/integration/engine-lifecycle.test.js, so the
// REAL SDK client path in createCall is exercised without mobile-mcp or a device.
//
//   never-init       reads stdin, never answers initialize, ignores stdin EOF
//                    (forces the SDK's SIGTERM step)
//   exit-after-init  completes the handshake, then exits — an engine death
//   stay-up          completes the handshake and stays up until closed

const mode = process.argv[2];

if (mode === 'never-init') {
  process.stdin.resume();
  setInterval(() => {}, 1000);
} else {
  const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
  const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
  const server = new Server({ name: 'mauto-fixture', version: '0.0.0' }, { capabilities: {} });
  if (mode === 'exit-after-init') {
    server.oninitialized = () => setTimeout(() => process.exit(0), 50);
  }
  server.connect(new StdioServerTransport());
}
