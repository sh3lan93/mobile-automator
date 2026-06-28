'use strict';

// VendorAdapters — `mauto init --agent <claude|cursor>`.
//
// Each adapter writes artifacts in the VENDOR'S OWN namespace, is idempotent
// (re-running yields identical files), and NEVER clobbers a user-authored file.
// The only shared file either adapter touches is the MCP config (`.mcp.json`
// for Claude, `.cursor/mcp.json` for Cursor): there we MERGE — owning only the
// `mauto` key under `mcpServers` and preserving every other server and field.

const fs = require('fs');
const path = require('path');

const guideEmitter = require('../guide/emitter');

const TOPICS = ['generate', 'execute', 'setup'];

// The single mauto MCP server entry merged into a vendor's mcp config.
const MAUTO_SERVER = { command: 'mauto', args: ['mcp'] };

// Thin slash-command body: a trigger that points the agent at the version-
// matched guide and reasserts the device-only-via-mauto invariant. Deliberately
// free of {{placeholders}} and mobile_* tool names.
function claudeCommandBody(topic) {
  return (
    `Run \`mauto guide ${topic}\` and follow it. ` +
    'Drive the device only through `mauto` verbs (never assume resource-ids).\n'
  );
}

// Merge MAUTO_SERVER under mcpServers.mauto in a JSON file, preserving every
// other server and top-level field. Creates the file (and parents) if absent.
// Returns { changed } so the caller can report write-vs-merge accurately and
// stay idempotent (no rewrite when the content is byte-identical).
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
  if (prev === next) {
    return { changed: false };
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, next);
  return { changed: true };
}

// Write a file only when its content differs — keeps re-runs idempotent and
// avoids touching a file a user may have customised to identical content.
function writeIfChanged(filePath, content) {
  const prev = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  if (prev === content) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return true;
}

const claude = {
  apply({ projectRoot }) {
    const written = [];
    const merged = [];

    const commandsDir = path.join(projectRoot, '.claude', 'commands');
    for (const topic of TOPICS) {
      const file = path.join(commandsDir, `mobile-automator-${topic}.md`);
      writeIfChanged(file, claudeCommandBody(topic));
      written.push(file);
    }

    const mcpPath = path.join(projectRoot, '.mcp.json');
    mergeMcpConfig(mcpPath);
    merged.push(mcpPath);

    return { agent: 'claude', written, merged };
  },
};

const cursor = {
  apply({ projectRoot }) {
    const written = [];
    const merged = [];

    // Cursor rule: a bootstrap pointer to the mauto CLI workflow surface.
    const rulePath = path.join(projectRoot, '.cursor', 'rules', 'mobile-automator.mdc');
    writeIfChanged(rulePath, cursorRuleBody());
    written.push(rulePath);

    const mcpPath = path.join(projectRoot, '.cursor', 'mcp.json');
    mergeMcpConfig(mcpPath);
    merged.push(mcpPath);

    return { agent: 'cursor', written, merged };
  },
};

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

const ADAPTERS = { claude, cursor };

module.exports = { ADAPTERS, MAUTO_SERVER };
