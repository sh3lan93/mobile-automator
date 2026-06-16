'use strict';

// Reasoning-delivery floor for the `mauto` CLI.
//
// emitGuide / emitSchema / emitBootstrap produce RAW content an agent injects
// directly into its own context (markdown / JSON schema / text). They do NOT
// wrap their output in the JSON envelope — only the CLI's ERROR paths (unknown
// topic/name) do that. See src/cli.js for the raw-vs-envelope wiring.
//
// These are structured STUBS in slice 3; the full prose ports land in later
// slices. The stubs are deliberately minimal but already honour every contract
// the lint guards enforce: no `{{placeholder}}` tokens, no leaked `mobile_*`
// tool names (the agent drives the device only through `mauto` verbs), and in
// platform-agnostic mode no OS / OS-specific tooling words — per-OS facts are
// reached through the four semantic actions, never named here.

const fs = require('fs');
const path = require('path');

const { interpolate } = require('./placeholders');

// Topics with REAL ported prose live as markdown content files (carrying
// `{{placeholder}}` tokens lifted from the Gemini SKILLs). They are emitted by
// loading the mode-appropriate file and running it through interpolate(...),
// which fills tokens from the workspace config and applies a fallback so no
// `{{` survives. Topics absent from this map fall through to the stub emitter.
const CONTENT_DIR = path.resolve(__dirname, 'content');
const PORTED_TOPICS = new Set(['generate', 'execute']);

const SCENARIO_SCHEMA = path.resolve(
  __dirname,
  '../../templates/mobile-automator-generator/references/scenario_schema.json'
);
const RESULT_SCHEMA = path.resolve(
  __dirname,
  '../../templates/mobile-automator-executor/references/result_schema.json'
);

const TOPICS = {
  generate:
    'Author a test scenario. The agent drives `mauto elements`/`tap`/`type`/`swipe`/`press` to explore the app, then assembles a scenario JSON validated with `mauto validate` against `mauto schema scenario`.',
  execute:
    'Run a scenario. The agent replays each step through `mauto` action verbs, evaluates checks with `mauto assert`, and records progress with `mauto result add-step` / `mauto result finalize`.',
  record:
    'Capture a scenario from live interaction. The agent observes the session and emits scenario JSON through `mauto` verbs.',
  setup:
    'Initialise the workspace. `mauto setup` scaffolds the mobile-automator tree and a config; `mauto config get/set` reads and updates it.',
};

const SEMANTIC_ACTIONS = ['press_back', 'dismiss_keyboard', 'grant_permission', 'deny_permission'];

function emitGuide(topic, { mode = 'platform-aware', projectRoot } = {}) {
  const summary = TOPICS[topic];
  if (!summary) {
    throw new Error(`unknown guide topic: ${topic}`);
  }

  if (PORTED_TOPICS.has(topic)) {
    const variant = mode === 'platform-agnostic' ? 'agnostic' : 'aware';
    const file = path.join(CONTENT_DIR, `${topic}.${variant}.md`);
    const template = fs.readFileSync(file, 'utf8');
    return interpolate(template, { projectRoot, mode });
  }

  const lines = [];
  lines.push(`# Guide: ${topic} (${mode})`);
  lines.push('');
  lines.push(summary);
  lines.push('');
  lines.push(`This guide directs the agent through \`mauto\` verbs for the \`${topic}\` workflow.`);

  if (mode === 'platform-agnostic') {
    lines.push('');
    lines.push(
      'Platform-agnostic: never rely on a specific platform. Map every OS-level gesture to one of the four semantic actions, executed through `mauto press`:'
    );
    lines.push('');
    for (const act of SEMANTIC_ACTIONS) {
      lines.push(`- \`${act}\``);
    }
  }

  lines.push('');
  lines.push('_(full guide content lands in a later slice)_');
  lines.push('');
  return lines.join('\n');
}

function emitSchema(name) {
  const file = name === 'scenario' ? SCENARIO_SCHEMA : name === 'result' ? RESULT_SCHEMA : null;
  if (!file) {
    throw new Error(`unknown schema name: ${name}`);
  }
  return fs.readFileSync(file, 'utf8');
}

function emitBootstrap() {
  const verbs = [
    ['elements', 'list the UI elements currently on screen'],
    ['tap', 'tap at absolute screen coordinates'],
    ['type', 'type text into the focused element'],
    ['swipe', 'swipe in a cardinal direction'],
    ['press', 'press a system/hardware button or semantic action'],
    ['screenshot', 'save a screenshot to a path'],
    ['assert', 'evaluate an assertion against the current screen'],
    ['validate', 'validate a scenario file against the scenario schema'],
    ['result', 'record step results and finalize a run'],
    ['setup', 'scaffold the workspace and write a config'],
    ['config', 'get/set values in the workspace config'],
    ['guide', 'print the guide for a workflow topic'],
    ['schema', 'print the scenario or result JSON schema'],
    ['record', 'capture a scenario from live interaction'],
  ];

  const lines = [];
  lines.push('# mauto bootstrap');
  lines.push('');
  lines.push('Verb map:');
  for (const [verb, desc] of verbs) {
    lines.push(`- \`mauto ${verb}\` — ${desc}`);
  }
  lines.push('');
  lines.push('Invariants:');
  lines.push('- Run `mauto guide <topic>` before first using a workflow.');
  lines.push('- Drive the device ONLY through `mauto` verbs.');
  lines.push('- Platform-agnostic: never rely on a stable element id from the view hierarchy.');
  lines.push('- Every action verb returns a JSON envelope ({ ok, data } or { ok:false, error }).');
  lines.push('');
  return lines.join('\n');
}

module.exports = { emitGuide, emitSchema, emitBootstrap, TOPICS, SEMANTIC_ACTIONS };
