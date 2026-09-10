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

const MODULE = '../../src/device/mobile-mcp-tools';

const { MOBILE_MCP_TOOL_NAMES, isKnownTool } = require(MODULE);

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
    const missing = [...toolsCalledByBridge()].filter((t) => !MOBILE_MCP_TOOL_NAMES.includes(t));
    expect(missing).toEqual([]);
  });

  it('claims no primitive the bridge never calls', () => {
    const called = toolsCalledByBridge();
    const stale = MOBILE_MCP_TOOL_NAMES.filter((t) => !called.has(t));
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

// The set being CLOSED is the entire basis of a redaction claim: event.js marks
// `tool` sends:true on the grounds that the recorded value is one of an
// enumerated set. That is only true if a consumer cannot widen the set.
//
// It is asserted behaviourally — mutate through whatever the module exports,
// then ask isKnownTool — rather than by checking Object.isFrozen, because
// Object.isFrozen is exactly what lied here: `Object.freeze(new Set(...))`
// freezes the Set's own properties and leaves `.add` / `.delete` / `.clear`
// working on the [[SetData]] internal slot, so the guarantee reported true over
// a wide-open allowlist. A test that checks the report would have passed.
describe('the allowlist is closed to its consumers', () => {
  const INJECTED = 'com.acme.injected';
  const REAL = 'mobile_press_button';

  // Fresh module per test: a mutation that DOES land must not leak into the
  // other cases and turn one failure into three confusing ones.
  function fresh() {
    jest.resetModules();
    return require(MODULE);
  }

  // Try one mutation through every non-function export. A throw is a PASS — it
  // means the handle refused — so each attempt is swallowed and the verdict is
  // taken from isKnownTool afterwards. Written against `Object.values` rather
  // than against a named export so it keeps holding if the representation of
  // the vocabulary changes again.
  function attackEveryExport(mod, mutate) {
    for (const value of Object.values(mod)) {
      if (value == null || typeof value === 'function') continue;
      try {
        mutate(value);
      } catch (_) {
        /* refused, which is the point */
      }
    }
  }

  it('cannot be widened by a consumer', () => {
    const mod = fresh();

    attackEveryExport(mod, (v) => v.add && v.add(INJECTED));
    attackEveryExport(mod, (v) => v.push && v.push(INJECTED));
    attackEveryExport(mod, (v) => {
      v[0] = INJECTED;
    });
    attackEveryExport(mod, (v) => {
      v[INJECTED] = true;
    });

    expect(mod.isKnownTool(INJECTED)).toBe(false);
  });

  it('cannot be narrowed by a consumer', () => {
    // The mirror failure, and the more dangerous one operationally: a cleared
    // allowlist rejects every real primitive, so `tool` silently stops being
    // recorded at all and the latency data goes anonymous.
    const mod = fresh();

    attackEveryExport(mod, (v) => v.delete && v.delete(REAL));
    attackEveryExport(mod, (v) => v.clear && v.clear());
    attackEveryExport(mod, (v) => {
      v.length = 0;
    });

    expect(mod.isKnownTool(REAL)).toBe(true);
  });
});
