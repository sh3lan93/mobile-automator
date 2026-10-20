'use strict';

// HostPlan — the single source of "what `mauto init --agent <host>` owns".
//
// Every byte init writes is a pure function of the installed package: the
// rendered skills, the claude command bodies, the cursor rule and the `mauto`
// MCP server entry. None of it reads config.json. So "is this host's
// integration stale?" is answered by "would init write different bytes?" — no
// version stamp exists or is needed (#144).
//
// The writers (adapters.js) and the detector (inspectHosts) both read
// `planHost`, so detection cannot drift from what init actually writes.

const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');

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

const HOSTS = Object.keys(SKILL_DEST);

// Filesystem errno values that mean "the workspace's integration files can't
// be read the way they normally sit" — a file or its parent is missing,
// unreadable, or a directory sits where a file is expected. The advisory
// surfaces that consume the inspection without failing (`guide`'s notice,
// init's pre-run probe) treat these as "say nothing", never as a reason to
// fail the verb. Any other errno (or a non-errno throw) escapes: a defect in
// the inspection itself must be visible, not silently absorbed.
const ADVISORY_FS_CODES = new Set(['ENOENT', 'EACCES', 'EPERM', 'EISDIR', 'ENOTDIR']);

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

// One SKILL.md folder per topic under the agent's skills dir. Only the folders
// we own are listed; foreign skill folders are never part of the plan.
function skillFiles(agent) {
  return SKILL_TOPICS.map((topic) => {
    const { dirName, content } = renderSkill(topic);
    return { rel: path.join(SKILL_DEST[agent], dirName, 'SKILL.md'), content };
  });
}

// Everything init owns for one host, in write order. `files` are written whole;
// `mcp` (when non-null) is the host config into which the `mauto` server entry
// is merged. Paths are relative to the project root.
function planHost(agent) {
  if (!Object.prototype.hasOwnProperty.call(SKILL_DEST, agent)) {
    throw new Error(`unknown agent: ${agent}`);
  }
  const files = [];
  let mcp = null;
  if (agent === 'claude') {
    for (const topic of TOPICS) {
      files.push({
        rel: path.join('.claude', 'commands', `mobile-automator-${topic}.md`),
        content: claudeCommandBody(topic),
      });
    }
    mcp = '.mcp.json';
  } else if (agent === 'cursor') {
    files.push({
      rel: path.join('.cursor', 'rules', 'mobile-automator.mdc'),
      content: cursorRuleBody(),
    });
    mcp = path.join('.cursor', 'mcp.json');
  }
  files.push(...skillFiles(agent));
  return { files, mcp };
}

function readOrNull(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

// The mauto entry is compared semantically — the user's formatting, key order
// and other servers never make a host look stale.
function inspectMcp(file) {
  const raw = readOrNull(file);
  if (raw === null) return { status: 'missing', hasEntry: false };
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    return { status: 'unreadable', hasEntry: false };
  }
  if (doc == null || typeof doc !== 'object' || Array.isArray(doc)) {
    return { status: 'unreadable', hasEntry: false };
  }
  const servers = doc.mcpServers;
  const entry =
    servers && typeof servers === 'object' && !Array.isArray(servers) ? servers.mauto : undefined;
  if (entry === undefined) return { status: 'missing', hasEntry: false };
  return {
    status: isDeepStrictEqual(entry, MAUTO_SERVER) ? 'current' : 'outdated',
    hasEntry: true,
  };
}

// Per-host report of what init owns vs. what is on disk. Never throws on a
// malformed host config (that is reported as 'unreadable').
function inspectHosts(projectRoot) {
  return HOSTS.map((agent) => {
    const plan = planHost(agent);
    let installed = false;
    const files = plan.files.map(({ rel, content }) => {
      const abs = path.join(projectRoot, rel);
      const onDisk = readOrNull(abs);
      if (onDisk !== null) installed = true;
      const status = onDisk === null ? 'missing' : onDisk === content ? 'current' : 'outdated';
      return { path: abs, status };
    });
    let mcp = null;
    if (plan.mcp) {
      const abs = path.join(projectRoot, plan.mcp);
      const { status, hasEntry } = inspectMcp(abs);
      if (hasEntry) installed = true;
      mcp = { path: abs, status };
    }
    const stale =
      installed &&
      (files.some((f) => f.status !== 'current') || (mcp !== null && mcp.status !== 'current'));
    return { agent, installed, stale, files, mcp };
  });
}

module.exports = {
  HOSTS,
  ADVISORY_FS_CODES,
  MAUTO_SERVER,
  SKILL_DEST,
  TOPICS,
  claudeCommandBody,
  cursorRuleBody,
  planHost,
  inspectHosts,
};
