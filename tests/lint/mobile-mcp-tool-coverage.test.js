'use strict';

// Structural guard, in the action-catalog / capability-catalog idiom.
//
// src/observe/event.js marks `tool` sends:true on the stated grounds that it is
// an enumerated mobile-mcp primitive name. The daemon reads that value out of a
// socket frame, and a Unix socket is reachable by anything on the machine, so
// the justification is only true if the recorded value is checked against a
// closed set first. This pins that set to the primitives DeviceBridge actually
// calls, in BOTH directions: a new bridge call that forgets the set records no
// tool name at all (silent metric loss), and a stale entry is a lie about what
// mauto does.

const fs = require('fs');
const path = require('path');

const { MOBILE_MCP_TOOLS, isKnownTool } = require('../../src/device/mobile-mcp-tools');

const BRIDGE_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'device', 'bridge.js'),
  'utf8'
);

// Matches the call form only — `this._call('mobile_x', …)` — so a tool name
// mentioned in a comment cannot satisfy or break the guard.
function toolsCalledByBridge() {
  const found = new Set();
  const re = /_call\(\s*'(mobile_[a-z_]+)'/g;
  let m;
  while ((m = re.exec(BRIDGE_SRC)) !== null) found.add(m[1]);
  return found;
}

describe('mobile-mcp tool allowlist', () => {
  it('knows every primitive the bridge calls', () => {
    const missing = [...toolsCalledByBridge()].filter((t) => !MOBILE_MCP_TOOLS.has(t));
    expect(missing).toEqual([]);
  });

  it('claims no primitive the bridge never calls', () => {
    const called = toolsCalledByBridge();
    const stale = [...MOBILE_MCP_TOOLS].filter((t) => !called.has(t));
    expect(stale).toEqual([]);
  });

  it('rejects anything that is not a known primitive', () => {
    expect(isKnownTool('mobile_press_button')).toBe(true);
    expect(isKnownTool('mobile_definitely_not_a_tool')).toBe(false);
    expect(isKnownTool('/Users/someone/secret-project/app.apk')).toBe(false);
    expect(isKnownTool(undefined)).toBe(false);
    expect(isKnownTool(null)).toBe(false);
    expect(isKnownTool(42)).toBe(false);
  });
});
