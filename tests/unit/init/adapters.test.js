'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

const { ADAPTERS } = require('../../../src/init/adapters');
const { SKILL_META } = require('../../../src/init/skill-meta');

const CONTENT_DIR = path.resolve(__dirname, '../../../src/guide/content');

function invariantLines(topic) {
  return fs
    .readFileSync(path.join(CONTENT_DIR, `${topic}.invariants.md`), 'utf8')
    .trim()
    .split('\n')
    .filter((line) => line.trim() !== '');
}

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

  // Drift guard for #139. A same-named skill takes precedence over a command,
  // so `.claude/commands/*.md` only ever wins where no skill is installed —
  // pre-skills Claude Code, or a workspace whose last `mauto init` predates the
  // release that started writing skills. Those users must not be handed a
  // weaker surface than the skill they are standing in for, so the command body
  // is DERIVED from the same two sources the skill renders from. Asserting the
  // derivation (not a substring) is what makes this a real guard: a "command is
  // a substring of the skill" check would keep passing while the skill grew any
  // number of new directives the command never gained.
  test('command body is derived from the skill sources — same discovery description, same invariants', () => {
    const projectRoot = tmpRoot();
    ADAPTERS.claude.apply({ projectRoot });

    for (const topic of ['generate', 'execute', 'setup']) {
      const body = fs.readFileSync(
        path.join(projectRoot, '.claude', 'commands', `mobile-automator-${topic}.md`),
        'utf8'
      );

      // The authored "use when…" description — the only thing a host has to
      // decide whether to surface this — must reach this path too, instead of
      // the body's first line being truncated into a description.
      expect(body).toContain(`description: ${SKILL_META[topic].description}`);

      // Every non-negotiable directive the skill inlines is present verbatim.
      for (const line of invariantLines(topic)) {
        expect(body).toContain(line);
      }

      // Still points at the live, mode-aware instruction surface.
      expect(body).toContain(`mauto guide ${topic}`);
    }
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

  test('a corrupt pre-existing .mcp.json throws a typed corrupt_mcp_config error, not a raw SyntaxError, and is left untouched', () => {
    const projectRoot = tmpRoot();
    const mcpPath = path.join(projectRoot, '.mcp.json');
    const corrupt = '{ "mcpServers": { ';
    fs.writeFileSync(mcpPath, corrupt);
    let caught;
    try {
      ADAPTERS.claude.apply({ projectRoot });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    // Identifiable, actionable error — not a bare SyntaxError the caller can't classify.
    expect(caught.code).toBe('corrupt_mcp_config');
    expect(caught).not.toBeInstanceOf(SyntaxError);
    // The user's file is never clobbered on a parse failure.
    expect(fs.readFileSync(mcpPath, 'utf8')).toBe(corrupt);
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

const { SKILL_DEST } = require('../../../src/init/adapters');

const ALL_AGENTS = ['claude', 'cursor', 'gemini', 'copilot', 'agents'];
const SKILL_TOPICS = ['generate', 'execute', 'setup'];

describe('skill installation across agents', () => {
  for (const agent of ALL_AGENTS) {
    test(`${agent}: writes a SKILL.md per topic in the agent skills dir`, () => {
      const projectRoot = tmpRoot();
      const res = require('../../../src/init/adapters').ADAPTERS[agent].apply({ projectRoot });
      expect(res.agent).toBe(agent);
      for (const topic of SKILL_TOPICS) {
        const f = path.join(projectRoot, SKILL_DEST[agent], `mobile-automator-${topic}`, 'SKILL.md');
        expect(fs.existsSync(f)).toBe(true);
        const body = fs.readFileSync(f, 'utf8');
        expect(body).toContain(`name: mobile-automator-${topic}`);
        expect(body).toContain(`mauto guide ${topic}`);
        expect(body).not.toContain('{{');
      }
    });

    test(`${agent}: re-running is idempotent (byte-identical SKILL.md)`, () => {
      const projectRoot = tmpRoot();
      const A = require('../../../src/init/adapters').ADAPTERS[agent];
      A.apply({ projectRoot });
      const f = path.join(projectRoot, SKILL_DEST[agent], 'mobile-automator-execute', 'SKILL.md');
      const first = fs.readFileSync(f, 'utf8');
      A.apply({ projectRoot });
      expect(fs.readFileSync(f, 'utf8')).toBe(first);
    });
  }

  test('does not touch a foreign skill folder', () => {
    const projectRoot = tmpRoot();
    const foreign = path.join(projectRoot, '.claude', 'skills', 'someones-skill', 'SKILL.md');
    fs.mkdirSync(path.dirname(foreign), { recursive: true });
    fs.writeFileSync(foreign, 'KEEP ME');
    require('../../../src/init/adapters').ADAPTERS.claude.apply({ projectRoot });
    expect(fs.readFileSync(foreign, 'utf8')).toBe('KEEP ME');
  });
});
