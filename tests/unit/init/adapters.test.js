'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

const { ADAPTERS } = require('../../../src/init/adapters');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-init-'));
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

describe('ADAPTERS.claude.apply', () => {
  test('writes the three slash-command files with thin triggers', () => {
    const projectRoot = tmpRoot();
    const res = ADAPTERS.claude.apply({ projectRoot });
    expect(res.agent).toBe('claude');

    const topics = ['generate', 'execute', 'setup'];
    for (const topic of topics) {
      const f = path.join(projectRoot, '.claude', 'commands', `mobile-automator-${topic}.md`);
      expect(fs.existsSync(f)).toBe(true);
      const body = fs.readFileSync(f, 'utf8');
      expect(body).toContain(`mauto guide ${topic}`);
      // No leaked placeholders or mcp tool names.
      expect(body).not.toContain('{{');
      expect(body).not.toMatch(/\bmobile_[a-z_]+/);
    }
    expect(res.written.length).toBeGreaterThanOrEqual(3);
  });

  test('creates .mcp.json with the mauto server entry', () => {
    const projectRoot = tmpRoot();
    ADAPTERS.claude.apply({ projectRoot });
    const mcp = readJson(path.join(projectRoot, '.mcp.json'));
    expect(mcp.mcpServers.mauto).toEqual({ command: 'mauto', args: ['mcp'] });
  });

  test('merge preserves a pre-existing other server and other fields', () => {
    const projectRoot = tmpRoot();
    const mcpPath = path.join(projectRoot, '.mcp.json');
    fs.writeFileSync(
      mcpPath,
      JSON.stringify({
        $schema: 'https://example/schema.json',
        mcpServers: { other: { command: 'other-bin', args: ['serve'] } },
      })
    );
    const res = ADAPTERS.claude.apply({ projectRoot });
    const mcp = readJson(mcpPath);
    // Other server + top-level field survive.
    expect(mcp.mcpServers.other).toEqual({ command: 'other-bin', args: ['serve'] });
    expect(mcp.$schema).toBe('https://example/schema.json');
    // mauto added.
    expect(mcp.mcpServers.mauto).toEqual({ command: 'mauto', args: ['mcp'] });
    expect(res.merged).toContain(mcpPath);
  });

  test('is idempotent — re-running yields the same files with no dupes', () => {
    const projectRoot = tmpRoot();
    ADAPTERS.claude.apply({ projectRoot });
    const firstMcp = fs.readFileSync(path.join(projectRoot, '.mcp.json'), 'utf8');
    const firstCmd = fs.readFileSync(
      path.join(projectRoot, '.claude', 'commands', 'mobile-automator-generate.md'),
      'utf8'
    );
    ADAPTERS.claude.apply({ projectRoot });
    const secondMcp = fs.readFileSync(path.join(projectRoot, '.mcp.json'), 'utf8');
    const secondCmd = fs.readFileSync(
      path.join(projectRoot, '.claude', 'commands', 'mobile-automator-generate.md'),
      'utf8'
    );
    expect(secondMcp).toBe(firstMcp);
    expect(secondCmd).toBe(firstCmd);
    const mcp = readJson(path.join(projectRoot, '.mcp.json'));
    expect(Object.keys(mcp.mcpServers)).toEqual(['mauto']);
  });
});

describe('ADAPTERS.cursor.apply', () => {
  test('writes the cursor rule with a bootstrap pointer', () => {
    const projectRoot = tmpRoot();
    const res = ADAPTERS.cursor.apply({ projectRoot });
    expect(res.agent).toBe('cursor');
    const rule = path.join(projectRoot, '.cursor', 'rules', 'mobile-automator.mdc');
    expect(fs.existsSync(rule)).toBe(true);
    const body = fs.readFileSync(rule, 'utf8');
    expect(body).toContain('mauto');
    expect(body).not.toContain('{{');
    expect(res.written).toContain(rule);
  });

  test('merges the mauto server into .cursor/mcp.json preserving others', () => {
    const projectRoot = tmpRoot();
    const mcpPath = path.join(projectRoot, '.cursor', 'mcp.json');
    fs.mkdirSync(path.dirname(mcpPath), { recursive: true });
    fs.writeFileSync(
      mcpPath,
      JSON.stringify({ mcpServers: { other: { command: 'x' } } })
    );
    ADAPTERS.cursor.apply({ projectRoot });
    const mcp = readJson(mcpPath);
    expect(mcp.mcpServers.other).toEqual({ command: 'x' });
    expect(mcp.mcpServers.mauto).toEqual({ command: 'mauto', args: ['mcp'] });
  });

  test('is idempotent', () => {
    const projectRoot = tmpRoot();
    ADAPTERS.cursor.apply({ projectRoot });
    const first = fs.readFileSync(path.join(projectRoot, '.cursor', 'mcp.json'), 'utf8');
    ADAPTERS.cursor.apply({ projectRoot });
    const second = fs.readFileSync(path.join(projectRoot, '.cursor', 'mcp.json'), 'utf8');
    expect(second).toBe(first);
  });
});
