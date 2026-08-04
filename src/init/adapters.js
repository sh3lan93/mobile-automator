'use strict';

// VendorAdapters — `mauto init --agent <claude|cursor|gemini|copilot|agents>`.
//
// Each adapter installs native Agent Skills (open standard: a SKILL.md folder
// per topic) into the agent's skills directory, and is idempotent (re-running
// yields byte-identical files). claude/cursor additionally keep writing their
// thin slash-command/rule and merging the shared `mauto` MCP server entry.
// Adapters never clobber a file they don't own.

const fs = require('fs');
const path = require('path');

const guideEmitter = require('../guide/emitter');
const { renderSkill, readInvariants, SKILL_TOPICS } = require('./skill-renderer');
const { SKILL_META } = require('./skill-meta');

const TOPICS = ['generate', 'execute', 'setup'];

// The single mauto MCP server entry merged into a vendor's mcp config.
const MAUTO_SERVER = { command: 'mauto', args: ['mcp'] };

// Per-agent skills directory (relative to projectRoot). claude uses its own
// namespace; cursor/gemini/copilot each use their native dir; `agents` targets
// the open-standard location.
const SKILL_DEST = {
  claude: path.join('.claude', 'skills'),
  cursor: path.join('.cursor', 'skills'),
  gemini: path.join('.gemini', 'skills'),
  copilot: path.join('.github', 'skills'),
  agents: path.join('.agents', 'skills'),
};

// BACK-COMPAT FALLBACK — NOT the live instruction surface for a current host.
//
// Claude Code merged custom commands into skills, and a same-named skill wins:
//   "if a skill and a command share the same name, the skill takes precedence"
//   https://code.claude.com/docs/en/skills
// We write both `mobile-automator-<topic>.md` here and a skill folder of the
// same name, so on any host with skills support THIS FILE IS NEVER READ.
// Editing it to change agent behavior on a current host does nothing — change
// `<topic>.invariants.md` (directives) or the guide content (workflow) instead.
//
// It still wins in two places, which is why it is kept and why it must not be
// thin: a Claude Code old enough to predate skills, and a workspace whose last
// `mauto init` predates the release that started writing skills. On both, this
// file IS the registered surface — so it renders from the same two sources the
// skill does (`SKILL_META` + `<topic>.invariants.md`) and can never drift into
// being the weaker of the two. The `description` frontmatter matters for the
// same reason: without it a host derives one by truncating the body, which
// yields a description of the mechanism rather than of when to use this.
function claudeCommandBody(topic) {
  return (
    '---\n' +
    `description: ${SKILL_META[topic].description}\n` +
    '---\n\n' +
    `Run \`mauto guide ${topic}\` and follow it.\n\n` +
    '## Non-negotiable directives (always apply)\n' +
    `${readInvariants(topic)}\n`
  );
}

function cursorRuleBody() {
  return (
    '---\n' +
    'description: Mobile Automator — drive mobile QA through the mauto CLI.\n' +
    'alwaysApply: true\n' +
    '---\n\n' +
    guideEmitter.emitBootstrap() +
    '\nRun `mauto guide <topic>` (generate|execute|setup) before a workflow. ' +
    'Drive the device only through `mauto` verbs.\n'
  );
}

function writeIfChanged(filePath, content) {
  const prev = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  if (prev === content) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return true;
}

function mergeMcpConfig(filePath) {
  let doc = {};
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf8');
    try {
      doc = JSON.parse(existing);
    } catch (err) {
      // A hand-edited / partially-written host config. Surface a typed,
      // actionable error instead of a bare SyntaxError, and never clobber the
      // user's file — re-running converges once they fix it.
      const e = new Error(`existing MCP config is not valid JSON: ${filePath}`);
      e.code = 'corrupt_mcp_config';
      throw e;
    }
    if (doc == null || typeof doc !== 'object' || Array.isArray(doc)) doc = {};
  }
  if (doc.mcpServers == null || typeof doc.mcpServers !== 'object') {
    doc.mcpServers = {};
  }
  doc.mcpServers.mauto = { ...MAUTO_SERVER };
  const next = JSON.stringify(doc, null, 2) + '\n';
  const prev = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  if (prev === next) return { changed: false };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, next);
  return { changed: true };
}

// Install one SKILL.md folder per topic under the agent's skills dir. Only the
// folders we own are written; foreign skill folders are never touched.
function writeSkills(projectRoot, agent, written) {
  const root = path.join(projectRoot, SKILL_DEST[agent]);
  for (const topic of SKILL_TOPICS) {
    const { dirName, content } = renderSkill(topic);
    const file = path.join(root, dirName, 'SKILL.md');
    writeIfChanged(file, content);
    written.push(file);
  }
}

function makeAdapter(agent, extra) {
  return {
    apply({ projectRoot }) {
      const written = [];
      const merged = [];
      if (extra) extra({ projectRoot, written, merged });
      writeSkills(projectRoot, agent, written);
      return { agent, written, merged };
    },
  };
}

const ADAPTERS = {
  claude: makeAdapter('claude', ({ projectRoot, written, merged }) => {
    const commandsDir = path.join(projectRoot, '.claude', 'commands');
    for (const topic of TOPICS) {
      const file = path.join(commandsDir, `mobile-automator-${topic}.md`);
      writeIfChanged(file, claudeCommandBody(topic));
      written.push(file);
    }
    const mcpPath = path.join(projectRoot, '.mcp.json');
    mergeMcpConfig(mcpPath);
    merged.push(mcpPath);
  }),

  cursor: makeAdapter('cursor', ({ projectRoot, written, merged }) => {
    const rulePath = path.join(projectRoot, '.cursor', 'rules', 'mobile-automator.mdc');
    writeIfChanged(rulePath, cursorRuleBody());
    written.push(rulePath);
    const mcpPath = path.join(projectRoot, '.cursor', 'mcp.json');
    mergeMcpConfig(mcpPath);
    merged.push(mcpPath);
  }),

  gemini: makeAdapter('gemini'),
  copilot: makeAdapter('copilot'),
  agents: makeAdapter('agents'),
};

module.exports = { ADAPTERS, MAUTO_SERVER, SKILL_DEST };
