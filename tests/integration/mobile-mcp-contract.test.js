'use strict';

// Engine-side contract guard: the PINNED @mobilenext/mobile-mcp still offers
// every primitive DeviceBridge calls, with the arguments DeviceBridge sends.
//
// Engine-side counterpart of tests/lint/mobile-mcp-tool-coverage.test.js. That
// guard pins MOBILE_MCP_TOOL_NAMES to the names bridge.js calls — both sides are
// OUR code, so it cannot notice the engine moving underneath them. This one asks
// the engine itself.
//
// Why it exists. mobile-mcp validates arguments against a NON-strict schema, so
// an argument the engine no longer knows is not rejected — it is dropped, and
// the call still reports success. This repo has already paid for that once:
// bridge.screenshot sent `path` instead of `saveTo`, and every screenshot was a
// silent no-op that said it worked (see DeviceBridge#screenshot). #199 is the
// same shape from the other side: 1.0.5 added `format` to
// mobile_list_elements_on_screen and changed its default. A future engine bump
// must fail the build when a tool we call disappears, when a key we send is no
// longer accepted, or when a newly REQUIRED key appears that we do not send.
//
// What is spawned: the real pinned server, resolved by production's own
// resolveServerEntry and started with the current node, exactly as createCall
// does. Only `listTools` is sent — never a tool call — so no device is needed
// (CI has none) and nothing reaches telemetry; MOBILEMCP_DISABLE_TELEMETRY=1 is
// belt and braces.
//
// What is compared is DERIVED, not hand-restated: every DeviceBridge method is
// driven against a recording rawCall behind production's makeCall, so the keys
// on the right-hand side are the ones mauto would put on the wire, including
// the `device` makeCall injects (and withholds from NO_DEVICE_TOOLS).

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { resolveServerEntry, makeCall } = require('../../src/device/mobile-mcp-client');
const { DeviceBridge } = require('../../src/device/bridge');
const { MOBILE_MCP_TOOL_NAMES } = require('../../src/device/mobile-mcp-tools');

const DEVICE_ID = 'd1';

// Canned engine replies, just plausible enough for each bridge method to run to
// completion. Shapes mirror what mobile-mcp returns (see the parsers each method
// feeds: element-model, device-model, crash-model, getScreenSize's regex).
const CANNED = {
  mobile_list_available_devices: {
    devices: [{ id: DEVICE_ID, platform: 'android', name: 'x', state: 'online' }],
  },
  mobile_list_elements_on_screen: 'Found these elements on screen: []',
  mobile_get_screen_size: 'Screen size is 1080x2400 pixels',
  mobile_list_crashes: [],
  mobile_get_crash: 'crash report text',
};

// Drive every DeviceBridge method that reaches the engine, and every optional
// argument shape, so the recorded key set per tool is the UNION of everything
// mauto can send. Returns Map<toolName, Set<key>>.
async function recordWhatTheBridgeSends() {
  const sent = new Map();
  const rawCall = async (toolName, args = {}) => {
    if (!sent.has(toolName)) sent.set(toolName, new Set());
    for (const k of Object.keys(args)) sent.get(toolName).add(k);
    return Object.prototype.hasOwnProperty.call(CANNED, toolName) ? CANNED[toolName] : 'ok';
  };
  // device: null exercises the auto-resolve path; the id still gets injected.
  const { call } = makeCall({ rawCall, device: null });
  const bridge = new DeviceBridge({ call });

  await bridge.listDevices();
  await bridge.listElements();
  await bridge.screenshot('/tmp/contract.png');
  await bridge.tap({ x: 1, y: 2 });
  await bridge.longPress({ x: 1, y: 2 });
  await bridge.longPress({ x: 1, y: 2, duration: 900 });
  await bridge.doubleTap({ x: 1, y: 2 });
  await bridge.type('hello');
  await bridge.swipe({ direction: 'up' });
  await bridge.swipe({ direction: 'right', x: 5, y: 500, distance: 400 });
  await bridge.getPlatform();
  await bridge.getScreenSize();
  await bridge.pressButton('BACK');
  await bridge.launchApp('com.example');
  await bridge.installApp('/tmp/app.apk');
  await bridge.uninstallApp('com.example');
  await bridge.openUrl('https://example.com');
  await bridge.setOrientation('portrait');
  await bridge.listCrashes();
  await bridge.getCrash('c1');

  return sent;
}

describe('pinned mobile-mcp engine contract (integration)', () => {
  let client;
  let serverTools; // Map<name, inputSchema>
  let sent;

  beforeAll(async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolveServerEntry()],
      env: { ...process.env, MOBILEMCP_DISABLE_TELEMETRY: '1' },
      // The server announces itself on stderr; keep it out of jest output.
      stderr: 'ignore',
    });
    client = new Client({ name: 'mauto-contract-test', version: '0.0.0' }, { capabilities: {} });
    await client.connect(transport);
    const { tools } = await client.listTools();
    serverTools = new Map(tools.map((t) => [t.name, t.inputSchema || {}]));
    sent = await recordWhatTheBridgeSends();
  }, 30000);

  afterAll(async () => {
    if (client) await client.close();
  });

  it('registers every primitive mauto calls', () => {
    const missing = MOBILE_MCP_TOOL_NAMES.filter((name) => !serverTools.has(name));
    expect(missing).toEqual([]);
  });

  it('exercised every primitive mauto calls (none slips past the argument check)', () => {
    const unexercised = MOBILE_MCP_TOOL_NAMES.filter((name) => !sent.has(name));
    expect(unexercised).toEqual([]);
  });

  it('accepts every argument mauto sends, and requires none mauto omits', () => {
    const violations = [];
    for (const [tool, keys] of sent) {
      const schema = serverTools.get(tool);
      if (!schema) continue; // reported by the registration assertion
      const accepted = new Set(Object.keys(schema.properties || {}));
      for (const key of keys) {
        if (!accepted.has(key)) violations.push(`${tool}: sends "${key}", engine does not accept it`);
      }
      for (const key of schema.required || []) {
        if (!keys.has(key)) violations.push(`${tool}: engine requires "${key}", mauto never sends it`);
      }
    }
    expect(violations).toEqual([]);
  });
});
