#!/usr/bin/env node
'use strict';

// A minimal MCP server for tests/integration/engine-lifecycle.test.js, so the
// REAL SDK client path in createCall is exercised without mobile-mcp or a device.
//
//   never-init       reads stdin, never answers initialize, ignores stdin EOF
//   wedged           never-init that also ignores SIGTERM — mobile-mcp installs
//                    a SIGTERM handler, which a blocked event loop cannot run
//   exit-after-init  completes the handshake, then exits — an engine death
//   stay-up          completes the handshake and stays up until closed
//
// An optional second argument is a file to write this process's pid to, so a
// test can prove the engine is gone rather than assume it.

const fs = require('fs');

const mode = process.argv[2];
if (process.argv[3]) fs.writeFileSync(process.argv[3], String(process.pid));

if (mode === 'never-init' || mode === 'wedged') {
  if (mode === 'wedged') process.on('SIGTERM', () => {});
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
