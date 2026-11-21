'use strict';

// #347, end to end through buildProgram: `mauto init` writes host files into
// the checkout and `mauto setup` scaffolds .mobile-automator/, and a cloned
// repo can commit any of those paths as a symlink. A refused path is an
// `environment` envelope that names the path, never what the link points at,
// and the link's target is left byte-identical.

const fs = require('fs');
const path = require('path');

const { CANARY, snapshot, fixture, runIn } = require('../helpers/workspace-safety');

// `.claude/skills` planted as a link to the outside dir, which already holds
// a skill folder carrying the canary.
function plantClaudeSkills(ws, outside) {
  const root = path.dirname(ws);
  fs.mkdirSync(path.join(outside, 'mobile-automator-generate'));
  fs.writeFileSync(path.join(outside, 'mobile-automator-generate', 'SKILL.md'), `${CANARY}\n`);
  fs.mkdirSync(path.join(root, '.claude'));
  fs.symlinkSync(outside, path.join(root, '.claude', 'skills'));
}

describe('init refuses a symlinked host path (#347)', () => {
  test('init --agent claude with .claude/skills -> outside fails environment', async () => {
    const { root, outside } = fixture(plantClaudeSkills);
    const before = snapshot(outside);

    const { calls, written } = await runIn(root, ['init', '--agent', 'claude']);

    expect(calls).toHaveLength(1);
    const [r] = calls;
    expect(r.exitKind).toBe('environment');
    expect(r.envelope.ok).toBe(false);
    expect(r.envelope.error.kind).toBe('environment');
    expect(r.envelope.error.message).toMatch(/^Refusing to use path /);
    expect(r.envelope.error.message).toContain(path.join(root, '.claude', 'skills'));
    // The refusal's own hint, not init's generic filesystem one.
    expect(r.envelope.hint).toMatch(/symbolic link/);
    expect(r.envelope.data.agents).toEqual([
      expect.objectContaining({ agent: 'claude', ok: false, error: 'unsafe_path' }),
    ]);
    expect(JSON.stringify(calls)).not.toContain(CANARY);
    expect(written).not.toContain(CANARY);
    expect(snapshot(outside)).toEqual(before);
  });

  test('init --agent all with the same plant: partial_failure, claude refused, the others written', async () => {
    const { root, outside } = fixture(plantClaudeSkills);
    const before = snapshot(outside);

    const { calls, written } = await runIn(root, ['init', '--agent', 'all']);

    expect(calls).toHaveLength(1);
    const [r] = calls;
    expect(r.exitKind).toBe('partial');
    expect(r.envelope.ok).toBe(false);
    expect(r.envelope.error.kind).toBe('partial_failure');
    const byAgent = Object.fromEntries(r.envelope.data.agents.map((a) => [a.agent, a]));
    expect(byAgent.claude).toEqual(expect.objectContaining({ ok: false, error: 'unsafe_path' }));
    expect(byAgent.claude.message).toMatch(/^Refusing to use path /);
    for (const agent of ['cursor', 'gemini', 'copilot', 'agents']) {
      expect(byAgent[agent].ok).toBe(true);
    }
    expect(fs.existsSync(path.join(root, '.gemini', 'skills', 'mobile-automator-generate', 'SKILL.md'))).toBe(true);
    expect(JSON.stringify(calls)).not.toContain(CANARY);
    expect(written).not.toContain(CANARY);
    expect(snapshot(outside)).toEqual(before);
  });
});

describe('setup refuses a symlinked workspace path (#347)', () => {
  test('setup with .mobile-automator/screenshots -> outside fails environment', async () => {
    const { root, ws, outside } = fixture((w, out) => {
      fs.writeFileSync(path.join(out, 'shot.png'), CANARY);
      fs.symlinkSync(out, path.join(w, 'screenshots'));
    });
    const before = snapshot(outside);

    const { calls, written } = await runIn(root, ['setup']);

    expect(calls).toHaveLength(1);
    const [r] = calls;
    expect(r.exitKind).toBe('environment');
    expect(r.envelope.ok).toBe(false);
    expect(r.envelope.error.kind).toBe('environment');
    expect(r.envelope.error.message).toMatch(/^Refusing to use workspace path /);
    expect(r.envelope.error.message).toContain(path.join(ws, 'screenshots'));
    expect(JSON.stringify(calls)).not.toContain(CANARY);
    expect(written).not.toContain(CANARY);
    expect(snapshot(outside)).toEqual(before);
  });
});
