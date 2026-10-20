'use strict';

// #212: mauto must be able to open app deep links (myapp://...). The pinned
// mobile-mcp rejects non-http(s) URLs unless MOBILEMCP_ALLOW_UNSAFE_URLS=1 is
// set in the ENGINE process, and buildEngineEnv is what createCall spawns the
// engine with. The engine's scheme check runs before its device lookup, so a
// bogus device id is enough to observe it — no device needed (CI has none).
//
// The control case (explicit "0") proves the first case passes for the right
// reason: if a future engine renames the variable, the default stops working
// and case one fails; if it drops the guard entirely, the control fails.

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { resolveServerEntry, buildEngineEnv } = require('../../src/device/mobile-mcp-client');

const SCHEME_REJECTION = 'Only http:// and https://';

async function spawnEngine(baseEnv) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolveServerEntry()],
    env: buildEngineEnv({ baseEnv }),
    stderr: 'ignore',
  });
  const client = new Client({ name: 'mauto-open-url-test', version: '0.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

async function openUrlText(client) {
  const res = await client.callTool({
    name: 'mobile_open_url',
    arguments: { device: 'mauto-no-such-device', url: 'myapp://home' },
  });
  return (res.content || [])
    .filter((c) => c && c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

describe('mobile_open_url custom schemes under the engine env mauto spawns (#212)', () => {
  const clients = [];

  afterAll(async () => {
    await Promise.all(clients.map((c) => c.close().catch(() => {})));
  });

  it('accepts a custom scheme by default (fails later, on the device lookup)', async () => {
    const baseEnv = { ...process.env, MOBILEMCP_DISABLE_TELEMETRY: '1' };
    delete baseEnv.MOBILEMCP_ALLOW_UNSAFE_URLS;
    const client = await spawnEngine(baseEnv);
    clients.push(client);
    const text = await openUrlText(client);
    expect(text).not.toContain(SCHEME_REJECTION);
    expect(text.length).toBeGreaterThan(0);
  }, 30000);

  it('control: an explicit MOBILEMCP_ALLOW_UNSAFE_URLS=0 restores the engine guard', async () => {
    const baseEnv = { ...process.env, MOBILEMCP_DISABLE_TELEMETRY: '1', MOBILEMCP_ALLOW_UNSAFE_URLS: '0' };
    const client = await spawnEngine(baseEnv);
    clients.push(client);
    const text = await openUrlText(client);
    expect(text).toContain(SCHEME_REJECTION);
  }, 30000);
});
