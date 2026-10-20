'use strict';

// #144 — the advisory `mauto guide` prepends when a host integration that
// `mauto init` wrote is missing or out of date. Pure function of the
// inspectHosts() report, so these tests feed it hand-built reports.

const { renderStaleNotice, initCommands } = require('../../../src/init/stale-notice');
const { HOSTS } = require('../../../src/init/host-plan');

function host(agent, { missing = 0, outdated = 0, current = 0, mcp = null } = {}) {
  const files = [];
  for (let i = 0; i < missing; i++) files.push({ path: `/p/${agent}/m${i}`, status: 'missing' });
  for (let i = 0; i < outdated; i++) files.push({ path: `/p/${agent}/o${i}`, status: 'outdated' });
  for (let i = 0; i < current; i++) files.push({ path: `/p/${agent}/c${i}`, status: 'current' });
  return {
    agent,
    installed: true,
    stale: true,
    files,
    mcp: mcp === null ? null : { path: `/p/${agent}/mcp.json`, status: mcp },
  };
}

describe('renderStaleNotice', () => {
  test('empty input renders nothing', () => {
    expect(renderStaleNotice([])).toBe('');
  });

  test('single host: counts files and the mcp entry, names the one command', () => {
    const out = renderStaleNotice([host('claude', { missing: 3, outdated: 3, mcp: 'current' })]);
    expect(out).toBe(
      '> **Notice — host integration out of date.** This project\'s agent integration was installed ' +
        'by an older `mauto` and is missing or out of date: claude (3 missing, 3 outdated). ' +
        'Tell the user to run `mauto init --agent claude` to refresh it, then continue with this guide.\n\n'
    );
  });

  test('mcp missing/outdated count toward the totals', () => {
    expect(renderStaleNotice([host('cursor', { outdated: 1, mcp: 'missing' })])).toContain(
      'cursor (1 missing, 1 outdated)'
    );
    expect(renderStaleNotice([host('cursor', { current: 4, mcp: 'outdated' })])).toContain('cursor (1 outdated)');
  });

  test('an unreadable mcp config is named rather than counted', () => {
    const out = renderStaleNotice([host('claude', { outdated: 2, mcp: 'unreadable' })]);
    expect(out).toContain('claude (2 outdated, MCP config unreadable)');
  });

  test('multiple hosts: each listed, one command per host, in HOSTS order', () => {
    const out = renderStaleNotice([host('gemini', { outdated: 3 }), host('claude', { missing: 3, mcp: 'current' })]);
    expect(out).toContain('claude (3 missing), gemini (3 outdated)');
    expect(out).toContain('run `mauto init --agent claude` and `mauto init --agent gemini`');
  });

  test('every host stale collapses to --agent all', () => {
    const out = renderStaleNotice(HOSTS.map((a) => host(a, { outdated: 1 })));
    expect(out).toContain('`mauto init --agent all`');
    expect(out).not.toContain('--agent claude');
  });

  test('deterministic: input order does not change output', () => {
    const a = [host('cursor', { outdated: 1 }), host('claude', { missing: 1 }), host('agents', { outdated: 2 })];
    expect(renderStaleNotice(a)).toBe(renderStaleNotice([...a].reverse()));
  });

  test('is a markdown blockquote ending in a blank line', () => {
    const out = renderStaleNotice([host('claude', { missing: 1 })]);
    expect(out.startsWith('> **Notice')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(true);
  });

  test('tells the agent to tell the user; never to run init itself', () => {
    const out = renderStaleNotice([host('claude', { missing: 1 })]);
    expect(out).toMatch(/Tell the user to run/);
    expect(out).not.toMatch(/\b(you should|now) run\b/i);
  });
});

describe('initCommands', () => {
  test('one command per stale host, HOSTS order', () => {
    expect(initCommands(['copilot', 'claude'])).toEqual(['mauto init --agent claude', 'mauto init --agent copilot']);
  });

  test('all hosts → --agent all', () => {
    expect(initCommands([...HOSTS])).toEqual(['mauto init --agent all']);
  });
});
