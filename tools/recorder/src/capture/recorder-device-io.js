'use strict';

// Slice 8: bridge the recorder's mobile-mcp device I/O onto the CLI-owned
// connection. Previously the live Mode-B lifecycle defaulted `call` to an
// in-process stub (`async () => ({ elements: [] })`); this factory wires it to
// the real CLI client (src/device/mobile-mcp-client.createCall) so a standalone
// `mauto record` run drives a real device through the same connection the rest
// of the CLI uses.
//
// The `createCall` dependency is INJECTABLE: tests pass a fake factory so they
// never spawn mobile-mcp, while the live path defaults to the real one. The
// real factory is required LAZILY so loading this module (and the recorder)
// does not pull in the MCP SDK until a live device session actually starts.

const path = require('path');

// Default factory: the CLI-owned mobile-mcp client at the repo root. Resolved
// from this file's location (tools/recorder/src/capture → repo root/src/device).
function defaultCreateCall(args) {
  // Lazy require so the MCP SDK only loads for a live session.
  // eslint-disable-next-line global-require
  const { createCall } = require(path.resolve(__dirname, '..', '..', '..', '..', 'src', 'device', 'mobile-mcp-client'));
  return createCall(args);
}

/**
 * Build the recorder's mobile-mcp call surface.
 *
 * @param {object} [opts]
 * @param {string} [opts.device]      device id to pin (passed through to the client)
 * @param {function} [opts.createCall] injectable factory ({device}) => Promise<{call, close}>
 * @returns {Promise<{call: function, close: function}>}
 */
async function createRecorderCall({ device, createCall = defaultCreateCall } = {}) {
  const conn = await createCall({ device });
  return {
    call: conn.call,
    close: typeof conn.close === 'function' ? conn.close : async () => {},
  };
}

module.exports = { createRecorderCall };
