'use strict';

const { emitGuide, emitBootstrap } = require('../../src/guide/emitter');

const TOPICS = ['generate', 'execute', 'setup'];
const MODES = ['platform-aware', 'platform-agnostic'];

// The CLI is the only interface the agent should see. Any leaked raw
// mobile-mcp tool name (mobile_list_elements_on_screen, mobile_tap, ...) is a
// contract break — the agent must drive the device through `mauto` verbs.
const MCP_TOOL = /\bmobile_[a-z_]+/;

describe('guide emitter — no leaked mobile-mcp tool names', () => {
  for (const topic of TOPICS) {
    for (const mode of MODES) {
      it(`${topic} (${mode}) names no mobile_* tool`, () => {
        expect(emitGuide(topic, { mode })).not.toMatch(MCP_TOOL);
      });
    }
  }

  it('bootstrap names no mobile_* tool', () => {
    expect(emitBootstrap()).not.toMatch(MCP_TOOL);
  });
});
