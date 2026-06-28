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
const { renderSkill, SKILL_TOPICS } = require('./skill-renderer');

const TOPICS = ['generate', 'execute', 'setup'];

// The single mauto MCP server entry merged into a vendor's mcp config.
const MAUTO_SERVER = { command: 'mauto', args: ['mcp'] };

// Per-agent skills directory (relative to projectRoot). claude uses its own
// namespace; cursor/gemini/copilot read their native dir; `agents` targets the
// universal open-standard location read by cursor/gemini/copilot too.
const SKILL_DEST = {
  claude: path.join('.claude', 'skills'),
  cursor: path.join('.cursor', 'skills'),
  gemini: path.join('.gemini', 'skills'),
  copilot: path.join('.github', 'skills'),
  agents: path.join('.agents', 'skills'),
};

function claudeCommandBody(topic) {
  return (
    `Run \`mauto guide ${topic}\` and follow it. ` +
    'Drive the device only through `mauto` verbs (never assume resource-ids).\n'
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
    doc = JSON.parse(fs.readFileSync(filePath, 'utf8'));
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
