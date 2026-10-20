'use strict';

// #144 — staleness is "would `mauto init` write different bytes?". The plan in
// host-plan.js is the single source both the writers (adapters.js) and the
// detector (inspectHosts) read, so these tests pin the detector against what
// the writers actually put on disk.

const os = require('os');
const fs = require('fs');
const path = require('path');

const { planHost, inspectHosts, HOSTS, MAUTO_SERVER } = require('../../../src/init/host-plan');
const { ADAPTERS } = require('../../../src/init/adapters');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-hostplan-'));
}

function byAgent(report) {
  return Object.fromEntries(report.map((h) => [h.agent, h]));
}

function write(root, rel, content) {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
  return f;
}

const TOPICS = ['generate', 'execute', 'setup'];

// The one-line command files a pre-0.21 `mauto init --agent claude` wrote.
function seedPre021(root) {
  for (const topic of TOPICS) {
    write(
      root,
      path.join('.claude', 'commands', `mobile-automator-${topic}.md`),
      `Run \`mauto guide ${topic}\` and follow it. Drive the device only through \`mauto\` verbs (never assume resource-ids).\n`
    );
  }
  write(root, '.mcp.json', JSON.stringify({ mcpServers: { mauto: { command: 'mauto', args: ['mcp'] } } }));
}

describe('HOSTS / planHost', () => {
  test('HOSTS lists the five supported hosts', () => {
    expect(HOSTS).toEqual(['claude', 'cursor', 'gemini', 'copilot', 'agents']);
  });

  test('claude plans three commands, then three skills, and merges .mcp.json', () => {
    const plan = planHost('claude');
    expect(plan.files.map((f) => f.rel)).toEqual([
      path.join('.claude', 'commands', 'mobile-automator-generate.md'),
      path.join('.claude', 'commands', 'mobile-automator-execute.md'),
      path.join('.claude', 'commands', 'mobile-automator-setup.md'),
      path.join('.claude', 'skills', 'mobile-automator-generate', 'SKILL.md'),
      path.join('.claude', 'skills', 'mobile-automator-execute', 'SKILL.md'),
      path.join('.claude', 'skills', 'mobile-automator-setup', 'SKILL.md'),
    ]);
    expect(plan.mcp).toBe('.mcp.json');
  });

  test('cursor plans its rule then skills, and merges .cursor/mcp.json', () => {
    const plan = planHost('cursor');
    expect(plan.files[0].rel).toBe(path.join('.cursor', 'rules', 'mobile-automator.mdc'));
    expect(plan.files).toHaveLength(4);
    expect(plan.mcp).toBe(path.join('.cursor', 'mcp.json'));
  });

  test.each(['gemini', 'copilot', 'agents'])('%s plans skills only, no mcp', (agent) => {
    const plan = planHost(agent);
    expect(plan.files).toHaveLength(3);
    expect(plan.mcp).toBeNull();
  });

  test('unknown agent throws', () => {
    expect(() => planHost('frobnicator')).toThrow(/unknown agent/);
  });

  test('MAUTO_SERVER is the mauto mcp entry', () => {
    expect(MAUTO_SERVER).toEqual({ command: 'mauto', args: ['mcp'] });
  });
});

describe('inspectHosts', () => {
  test('drift guard: whatever every adapter writes, inspectHosts reports as current', () => {
    const root = tmpRoot();
    for (const agent of HOSTS) ADAPTERS[agent].apply({ projectRoot: root });
    const report = inspectHosts(root);
    expect(report.map((h) => h.agent)).toEqual(HOSTS);
    for (const host of report) {
      expect(host.installed).toBe(true);
      expect(host.stale).toBe(false);
      expect(host.files.length).toBe(planHost(host.agent).files.length);
      for (const f of host.files) {
        expect(path.isAbsolute(f.path)).toBe(true);
        expect(f.status).toBe('current');
      }
      if (planHost(host.agent).mcp) expect(host.mcp.status).toBe('current');
      else expect(host.mcp).toBeNull();
    }
  });

  test('empty project: nothing installed, nothing stale', () => {
    const report = inspectHosts(tmpRoot());
    for (const host of report) {
      expect(host.installed).toBe(false);
      expect(host.stale).toBe(false);
      expect(host.files.every((f) => f.status === 'missing')).toBe(true);
    }
  });

  test('pre-0.21 workspace: claude installed + stale (skills missing, commands outdated, mcp current); others untouched', () => {
    const root = tmpRoot();
    seedPre021(root);
    const hosts = byAgent(inspectHosts(root));
    const claude = hosts.claude;
    expect(claude.installed).toBe(true);
    expect(claude.stale).toBe(true);
    for (const f of claude.files) {
      const expected = f.path.includes(`${path.sep}skills${path.sep}`) ? 'missing' : 'outdated';
      expect(f.status).toBe(expected);
    }
    expect(claude.mcp).toEqual({ path: path.join(root, '.mcp.json'), status: 'current' });
    for (const agent of ['cursor', 'gemini', 'copilot', 'agents']) {
      expect(hosts[agent].installed).toBe(false);
      expect(hosts[agent].stale).toBe(false);
    }
  });

  test('a hand-edited skill is outdated and makes the host stale', () => {
    const root = tmpRoot();
    ADAPTERS.gemini.apply({ projectRoot: root });
    const f = path.join(root, '.gemini', 'skills', 'mobile-automator-execute', 'SKILL.md');
    fs.appendFileSync(f, '\nmy local tweak\n');
    const gemini = byAgent(inspectHosts(root)).gemini;
    expect(gemini.stale).toBe(true);
    expect(gemini.files.find((x) => x.path === f).status).toBe('outdated');
  });

  test('a deleted skill is missing and makes the host stale', () => {
    const root = tmpRoot();
    ADAPTERS.agents.apply({ projectRoot: root });
    const f = path.join(root, '.agents', 'skills', 'mobile-automator-setup', 'SKILL.md');
    fs.rmSync(f);
    const agents = byAgent(inspectHosts(root)).agents;
    expect(agents.installed).toBe(true);
    expect(agents.stale).toBe(true);
    expect(agents.files.find((x) => x.path === f).status).toBe('missing');
  });

  test('a corrupt .mcp.json reports unreadable and never throws', () => {
    const root = tmpRoot();
    ADAPTERS.claude.apply({ projectRoot: root });
    fs.writeFileSync(path.join(root, '.mcp.json'), '{ not json');
    let report;
    expect(() => {
      report = inspectHosts(root);
    }).not.toThrow();
    const claude = byAgent(report).claude;
    expect(claude.mcp.status).toBe('unreadable');
    expect(claude.installed).toBe(true);
    expect(claude.stale).toBe(true);
  });

  test('a corrupt .mcp.json alone does not make claude installed', () => {
    const root = tmpRoot();
    write(root, '.mcp.json', '{ nope');
    const claude = byAgent(inspectHosts(root)).claude;
    expect(claude.installed).toBe(false);
    expect(claude.mcp.status).toBe('unreadable');
  });

  test('a non-object .mcp.json is unreadable, not a throw', () => {
    const root = tmpRoot();
    write(root, '.mcp.json', '[1,2]');
    expect(byAgent(inspectHosts(root)).claude.mcp.status).toBe('unreadable');
  });

  test('mcp is compared semantically: reformatted file with extra servers is still current', () => {
    const root = tmpRoot();
    ADAPTERS.claude.apply({ projectRoot: root });
    write(
      root,
      '.mcp.json',
      JSON.stringify({ mcpServers: { other: { command: 'x' }, mauto: { args: ['mcp'], command: 'mauto' } } })
    );
    const claude = byAgent(inspectHosts(root)).claude;
    expect(claude.mcp.status).toBe('current');
    expect(claude.stale).toBe(false);
  });

  test('an mcp file without a mauto entry is missing; a changed mauto entry is outdated', () => {
    const root = tmpRoot();
    ADAPTERS.cursor.apply({ projectRoot: root });
    const mcpPath = path.join(root, '.cursor', 'mcp.json');
    fs.writeFileSync(mcpPath, JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
    expect(byAgent(inspectHosts(root)).cursor.mcp.status).toBe('missing');
    fs.writeFileSync(mcpPath, JSON.stringify({ mcpServers: { mauto: { command: 'npx', args: ['mauto', 'mcp'] } } }));
    const cursor = byAgent(inspectHosts(root)).cursor;
    expect(cursor.mcp.status).toBe('outdated');
    expect(cursor.stale).toBe(true);
  });

  test('an mcp file with only a mauto entry marks the host installed', () => {
    const root = tmpRoot();
    write(root, '.mcp.json', JSON.stringify({ mcpServers: { mauto: MAUTO_SERVER } }));
    const claude = byAgent(inspectHosts(root)).claude;
    expect(claude.installed).toBe(true);
    expect(claude.stale).toBe(true);
  });

  test('a foreign skill folder and an unrelated .github/ never make copilot installed', () => {
    const root = tmpRoot();
    write(root, path.join('.github', 'skills', 'someones-skill', 'SKILL.md'), 'KEEP ME');
    write(root, path.join('.github', 'workflows', 'x.yml'), 'on: push\n');
    const copilot = byAgent(inspectHosts(root)).copilot;
    expect(copilot.installed).toBe(false);
    expect(copilot.stale).toBe(false);
  });
});
