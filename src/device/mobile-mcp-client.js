'use strict';

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

// Integration glue: spawns mobile-mcp over stdio and returns a `call`
// function shaped exactly like the one DeviceBridge expects.
// NOT unit-tested (would require spawning mobile-mcp); see the smoke test.
async function createCall({ device } = {}) {
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['-y', '@mobilenext/mobile-mcp@latest'],
    // mobile-mcp reads the target device from the environment / its own
    // selection; we pass it through when provided so callers can pin a device.
    env: device ? { ...process.env, MOBILE_MCP_DEVICE: device } : process.env,
  });

  const client = new Client(
    { name: 'mauto', version: '0.1.0' },
    { capabilities: {} }
  );

  await client.connect(transport);

  async function call(toolName, args = {}) {
    const res = await client.callTool({ name: toolName, arguments: args });
    return parseToolResult(res);
  }

  async function close() {
    try {
      await client.close();
    } catch (_e) {
      // best-effort teardown
    }
  }

  return { call, close };
}

// mobile-mcp returns its payload as text content that is itself JSON.
// Parse defensively: prefer JSON text content, fall back to raw text/struct.
function parseToolResult(res) {
  if (!res) return null;
  if (res.structuredContent !== undefined) return res.structuredContent;

  const content = res.content;
  if (Array.isArray(content)) {
    const texts = content
      .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text);
    for (const t of texts) {
      try {
        return JSON.parse(t);
      } catch (_e) {
        // not JSON; keep looking, fall through to raw join
      }
    }
    if (texts.length) return texts.join('\n');
  }
  return res;
}

module.exports = { createCall };
