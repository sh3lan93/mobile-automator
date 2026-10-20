'use strict';

// The advisory `mauto guide` prepends when a host integration that
// `mauto init` wrote is missing or out of date (#144).
//
// Every surface init has ever written tells the agent to run
// `mauto guide <topic>`, so a notice here reaches every stale workspace. It
// tells the agent to TELL THE USER — init is never run on the user's behalf.
//
// The text is read by the agent alongside the guide, so it is held to the
// guide lint guards: no OS names, no `{{`, no raw engine tool names
// (tests/lint/stale-notice-fixture.js feeds it to them).

const { HOSTS } = require('./host-plan');

function byHostOrder(a, b) {
  return HOSTS.indexOf(a) - HOSTS.indexOf(b);
}

// The init command(s) that refresh `agents`: one per host, in HOSTS order, or
// the single `--agent all` when every host needs it.
function initCommands(agents) {
  const unique = [...new Set(agents)].sort(byHostOrder);
  if (HOSTS.every((h) => unique.includes(h))) return ['mauto init --agent all'];
  return unique.map((a) => `mauto init --agent ${a}`);
}

function describeHost(h) {
  const statuses = h.files.map((f) => f.status);
  if (h.mcp) statuses.push(h.mcp.status);
  const missing = statuses.filter((s) => s === 'missing').length;
  const outdated = statuses.filter((s) => s === 'outdated').length;
  const parts = [];
  if (missing) parts.push(`${missing} missing`);
  if (outdated) parts.push(`${outdated} outdated`);
  if (h.mcp && h.mcp.status === 'unreadable') parts.push('MCP config unreadable');
  return `${h.agent} (${parts.join(', ')})`;
}

function joinList(items) {
  if (items.length <= 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

// `staleHosts`: entries from inspectHosts() with `stale: true`. Returns a
// markdown blockquote followed by a blank line, or '' when there is nothing
// stale. Output is independent of input order.
function renderStaleNotice(staleHosts) {
  if (!staleHosts || staleHosts.length === 0) return '';
  const hosts = [...staleHosts].sort((a, b) => byHostOrder(a.agent, b.agent));
  const commands = initCommands(hosts.map((h) => h.agent)).map((c) => `\`${c}\``);
  return (
    '> **Notice — host integration out of date.** This project\'s agent integration was installed ' +
    'by an older `mauto` and is missing or out of date: ' +
    `${hosts.map(describeHost).join(', ')}. ` +
    `Tell the user to run ${joinList(commands)} to refresh it, then continue with this guide.\n\n`
  );
}

module.exports = { renderStaleNotice, initCommands };
