'use strict';

// `mauto mcp` — the MCP prompts server.
//
// Advertises the PROMPTS capability only. The four mobile-QA workflows are
// surfaced as user-controlled prompts (see src/mcp/prompts.js); the device is
// NOT exposed as MCP tools — it stays behind the `mauto` CLI verbs by design.
//
// The SDK exports CJS entry points under ./<sub>; the exact paths were
// confirmed via require.resolve at build time:
//   @modelcontextprotocol/sdk/server/index.js   -> Server
//   @modelcontextprotocol/sdk/server/stdio.js   -> StdioServerTransport
//   @modelcontextprotocol/sdk/types.js          -> ListPromptsRequestSchema, GetPromptRequestSchema

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const {
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const { buildPromptHandlers } = require('./prompts');

// Construct the Server, register the prompt request handlers, but DO NOT
// connect a transport — separated so it can be exercised in tests without
// hijacking stdio.
function buildServer({ projectRoot } = {}) {
  const handlers = buildPromptHandlers({ projectRoot });

  const server = new Server(
    { name: 'mauto', version: require('../../package.json').version },
    { capabilities: { prompts: {} } }
  );

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: handlers.listPrompts(),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    return handlers.getPrompt(request.params.name);
  });

  return { server, handlers };
}

// Long-lived: connect the stdio transport and keep serving. Never called in
// the test suite (it would seize stdio).
async function runServer({ projectRoot } = {}) {
  const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
  const { server } = buildServer({ projectRoot });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}

module.exports = { runServer, buildServer };
