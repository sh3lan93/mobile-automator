'use strict';

// VendorAdapters — `mauto init --agent <claude|cursor|gemini|copilot|agents>`.
//
// Each adapter installs native Agent Skills (open standard: a SKILL.md folder
// per topic) into the agent's skills directory, and is idempotent (re-running
// yields byte-identical files). claude/cursor additionally keep writing their
// thin slash-command/rule and merging the shared `mauto` MCP server entry.
// Adapters never clobber a file they don't own.
//
// WHAT each host owns lives in host-plan.js (`planHost`); this module only
// applies that plan, so the staleness detector and the writers share one
// source (#144).
//
// Every host path sits in a checkout a clone can fill with symlinks
// (.claude/skills -> ~/.ssh, a dangling .mcp.json -> anywhere), so it is read
// and written only through safe-fs's project scope (#347): a link on the way,
// or at the leaf, dangling or not, throws UnsafePathError and its target is
// never read, written or created.

const path = require('path');

const { planHost, HOSTS, MAUTO_SERVER, SKILL_DEST } = require('./host-plan');
const { readProjectFile } = require('../workspace/safe-fs');
const { atomicProjectWrite } = require('../util/atomic');

// Returns 'created' | 'updated' | 'unchanged'.
function writeIfChanged(projectRoot, filePath, content) {
  const prev = readProjectFile(projectRoot, filePath);
  if (prev === content) return 'unchanged';
  atomicProjectWrite(projectRoot, filePath, content);
  return prev === null ? 'created' : 'updated';
}

// Returns { changed, status } where status is 'created' | 'updated' | 'unchanged'.
function mergeMcpConfig(projectRoot, filePath) {
  let doc = {};
  const prev = readProjectFile(projectRoot, filePath);
  if (prev !== null) {
    try {
      doc = JSON.parse(prev);
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
  if (prev === next) return { changed: false, status: 'unchanged' };
  atomicProjectWrite(projectRoot, filePath, next);
  return { changed: true, status: prev === null ? 'created' : 'updated' };
}

function makeAdapter(agent) {
  return {
    apply({ projectRoot }) {
      const plan = planHost(agent);
      const changes = [];
      for (const { rel, content } of plan.files) {
        const file = path.join(projectRoot, rel);
        changes.push({ path: file, status: writeIfChanged(projectRoot, file, content) });
      }
      if (plan.mcp) {
        const mcpPath = path.join(projectRoot, plan.mcp);
        changes.push({ path: mcpPath, status: mergeMcpConfig(projectRoot, mcpPath).status });
      }
      return { agent, changes };
    },
  };
}

const ADAPTERS = Object.fromEntries(HOSTS.map((agent) => [agent, makeAdapter(agent)]));

module.exports = { ADAPTERS, MAUTO_SERVER, SKILL_DEST };
