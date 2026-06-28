'use strict';

// MCP prompt handlers for the `mauto mcp` server.
//
// The workflows are exposed as USER-CONTROLLED MCP prompts (not tools — the
// device stays behind CLI verbs). Each prompt injects the version-matched
// `mauto guide <topic>` content as a single user message, so an agent that
// selects e.g. the `generate` prompt receives the exact same guidance a human
// would get from `mauto guide generate`.
//
// Naming scheme: prompts are named by the BARE topic (`generate`, `execute`,
// `setup`) — identical to the `mauto guide <topic>` argument, so the
// two surfaces stay one-to-one and self-documenting.

const guideEmitter = require('../guide/emitter');
const configManager = require('../config/manager');

const PROMPT_TOPICS = ['generate', 'execute', 'setup'];

const DESCRIPTIONS = {
  generate: 'Author a mobile test scenario by exploring the app with mauto verbs.',
  execute: 'Replay a scenario step-by-step and record the run results.',
  setup: 'Initialise the mobile-automator workspace and config.',
};

// Build the { listPrompts, getPrompt } pair. emitGuide + config are injectable
// so the handlers can be unit-tested without touching the real guide files.
function buildPromptHandlers({ projectRoot, emitGuide, config = configManager } = {}) {
  const emit = emitGuide || guideEmitter.emitGuide;

  function listPrompts() {
    return PROMPT_TOPICS.map((topic) => ({
      name: topic,
      description: DESCRIPTIONS[topic],
      arguments: [],
    }));
  }

  function getPrompt(name) {
    if (!PROMPT_TOPICS.includes(name)) {
      throw new Error(`unknown prompt: ${name}`);
    }
    const cfg = config.load(projectRoot);
    const mode = config.resolveMode(cfg);
    const text = emit(name, { mode, projectRoot });
    return {
      description: DESCRIPTIONS[name],
      messages: [{ role: 'user', content: { type: 'text', text } }],
    };
  }

  return { listPrompts, getPrompt };
}

module.exports = { buildPromptHandlers, PROMPT_TOPICS };
