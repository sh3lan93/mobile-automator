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
    expect(res.changes.length).toBeGreaterThanOrEqual(3);
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
    // The merge added the mauto entry to a file that lacked it.
    expect(res.changes.find((c) => c.path === mcpPath).status).toBe('updated');
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
    expect(res.changes.find((c) => c.path === rule).status).toBe('created');
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

// #144 — apply reports a per-file change status, and every owned file (not just
// one skill) is byte-identical on a rerun. Driven by planHost so a newly owned
// file is covered without editing this test.
describe('apply: per-file changes + full idempotence (#144)', () => {
  const { planHost } = require('../../../src/init/host-plan');

  for (const agent of ALL_AGENTS) {
    test(`${agent}: changes are created, then unchanged on rerun, then updated after a hand edit`, () => {
      const projectRoot = tmpRoot();
      const A = require('../../../src/init/adapters').ADAPTERS[agent];
      const plan = planHost(agent);
      const expectedPaths = plan.files
        .map((f) => path.join(projectRoot, f.rel))
        .concat(plan.mcp ? [path.join(projectRoot, plan.mcp)] : []);

      const first = A.apply({ projectRoot });
      expect(first.changes.map((c) => c.path)).toEqual(expectedPaths);
      expect(first.changes.every((c) => c.status === 'created')).toBe(true);
      // `changes` is the only per-file record apply reports, and it carries
      // every owned file in plan order (mcp last, when the host owns one).
      expect(first.changes.every((c) => expectedPaths.includes(c.path))).toBe(true);

      const before = Object.fromEntries(expectedPaths.map((p) => [p, fs.readFileSync(p, 'utf8')]));
      const second = A.apply({ projectRoot });
      expect(second.changes.every((c) => c.status === 'unchanged')).toBe(true);
      for (const p of expectedPaths) expect(fs.readFileSync(p, 'utf8')).toBe(before[p]);

      const edited = expectedPaths[0];
      fs.appendFileSync(edited, '\nhand edit\n');
      const third = A.apply({ projectRoot });
      const byPath = Object.fromEntries(third.changes.map((c) => [c.path, c.status]));
      expect(byPath[edited]).toBe('updated');
      expect(third.changes.filter((c) => c.status !== 'unchanged')).toHaveLength(1);
      expect(fs.readFileSync(edited, 'utf8')).toBe(before[edited]);
    });
  }

  test('mcp merge into an existing file without a mauto entry reports updated', () => {
    const projectRoot = tmpRoot();
    const mcpPath = path.join(projectRoot, '.mcp.json');
    fs.writeFileSync(mcpPath, JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
    const r = require('../../../src/init/adapters').ADAPTERS.claude.apply({ projectRoot });
    expect(r.changes.find((c) => c.path === mcpPath).status).toBe('updated');
  });
});

// #347: a cloned repo can commit any host path init writes as a symlink. The
// adapters read and write only through safe-fs's project scope, so a link on
// the way (a directory or the leaf itself, dangling or not) is refused and its
// target is never read, written or created.
describe('apply refuses a symlinked host path (#347)', () => {
  const { UnsafePathError } = require('../../../src/workspace/safe-fs');
  const { CANARY, tmpDir, snapshot } = require('../../helpers/workspace-safety');

  // A real project dir plus a sibling outside/ the links point into.
  function project() {
    const base = tmpDir('mauto-init-confine-');
    const projectRoot = path.join(base, 'project');
    const outside = path.join(base, 'outside');
    fs.mkdirSync(projectRoot);
    fs.mkdirSync(outside);
    return { projectRoot, outside };
  }

  function applyClaude(projectRoot) {
    let caught;
    try {
      ADAPTERS.claude.apply({ projectRoot });
    } catch (err) {
      caught = err;
    }
    return caught;
  }

  // Every regular file under the project, for "no written file contains the
  // canary". Links are skipped: reading one would follow it to the canary.
  function writtenContents(dir) {
    const out = [];
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.lstatSync(p);
      if (st.isDirectory()) out.push(writtenContents(p));
      else if (st.isFile()) out.push(fs.readFileSync(p, 'utf8'));
    }
    return out.join('\n');
  }

  test('.claude/skills -> outside dir is refused and the outside dir stays empty', () => {
    const { projectRoot, outside } = project();
    fs.mkdirSync(path.join(projectRoot, '.claude'));
    fs.symlinkSync(outside, path.join(projectRoot, '.claude', 'skills'));

    const err = applyClaude(projectRoot);

    expect(err).toBeInstanceOf(UnsafePathError);
    expect(err.reason).toBe('symlink');
    expect(err.path).toBe(path.join(projectRoot, '.claude', 'skills'));
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  test('a leaf symlink to an outside file is refused and the file is unchanged', () => {
    const { projectRoot, outside } = project();
    const target = path.join(outside, 'cmd.md');
    fs.writeFileSync(target, `${CANARY}\n`);
    const leaf = path.join(projectRoot, '.claude', 'commands', 'mobile-automator-generate.md');
    fs.mkdirSync(path.dirname(leaf), { recursive: true });
    fs.symlinkSync(target, leaf);
    const before = snapshot(outside);

    const err = applyClaude(projectRoot);

    expect(err).toBeInstanceOf(UnsafePathError);
    expect(err.path).toBe(leaf);
    expect(err.message).not.toContain(CANARY);
    expect(snapshot(outside)).toEqual(before);
    expect(fs.lstatSync(leaf).isSymbolicLink()).toBe(true);
  });

  test('a dangling leaf symlink is refused and its target is not created', () => {
    const { projectRoot, outside } = project();
    const target = path.join(outside, 'created-by-init.md');
    const leaf = path.join(projectRoot, '.claude', 'commands', 'mobile-automator-generate.md');
    fs.mkdirSync(path.dirname(leaf), { recursive: true });
    fs.symlinkSync(target, leaf);

    const err = applyClaude(projectRoot);

    expect(err).toBeInstanceOf(UnsafePathError);
    expect(err.reason).toBe('symlink');
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  test('.mcp.json -> outside JSON file is refused, left unchanged, and never merged into a written file', () => {
    const { projectRoot, outside } = project();
    const target = path.join(outside, 'mcp.json');
    fs.writeFileSync(target, JSON.stringify({ mcpServers: { secret: { command: CANARY } } }));
    fs.symlinkSync(target, path.join(projectRoot, '.mcp.json'));
    const before = snapshot(outside);

    const err = applyClaude(projectRoot);

    expect(err).toBeInstanceOf(UnsafePathError);
    expect(err.path).toBe(path.join(projectRoot, '.mcp.json'));
    expect(err.message).not.toContain(CANARY);
    expect(snapshot(outside)).toEqual(before);
    expect(writtenContents(projectRoot)).not.toContain(CANARY);
  });

  // A hard link is no symlink, so the read accepts it (it is ours and
  // regular); but writing through it would rewrite the outside file by another
  // name. The write replaces the entry instead, leaving the outside file alone.
  test('a stale leaf hard-linked to an outside file is replaced, never written through', () => {
    const { projectRoot, outside } = project();
    const target = path.join(outside, 'cmd.md');
    fs.writeFileSync(target, `${CANARY}\n`);
    const leaf = path.join(projectRoot, '.claude', 'commands', 'mobile-automator-generate.md');
    fs.mkdirSync(path.dirname(leaf), { recursive: true });
    fs.linkSync(target, leaf);
    const before = snapshot(outside);

    const res = ADAPTERS.claude.apply({ projectRoot });

    expect(res.changes.find((c) => c.path === leaf).status).toBe('updated');
    expect(snapshot(outside)).toEqual(before);
    expect(fs.readFileSync(leaf, 'utf8')).not.toContain(CANARY);
    expect(fs.statSync(leaf).nlink).toBe(1);
  });

  test('a clean tree stays idempotent: a rerun reports every file unchanged', () => {
    const { projectRoot } = project();
    const first = ADAPTERS.claude.apply({ projectRoot });
    expect(first.changes.every((c) => c.status === 'created')).toBe(true);
    const second = ADAPTERS.claude.apply({ projectRoot });
    expect(second.changes.every((c) => c.status === 'unchanged')).toBe(true);
  });
});
