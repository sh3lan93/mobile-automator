// tests/unit/install-skills/archive.test.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { archiveExistingSkills } = require('../../../scripts/install-skills.js');

function setupSkills(workspace) {
  const dirs = [
    '.gemini/skills/mobile-automator-generator',
    '.gemini/skills/mobile-automator-executor',
  ];
  for (const d of dirs) {
    fs.mkdirSync(path.join(workspace, d), { recursive: true });
    fs.writeFileSync(path.join(workspace, d, 'SKILL.md'), 'old content');
  }
}

describe('archiveExistingSkills', () => {
  it('moves skill dirs into .archive/<role>-<oldMode>-<ISO>/', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-'));
    setupSkills(dir);

    archiveExistingSkills(dir, 'platform-aware');

    expect(fs.existsSync(path.join(dir, '.gemini/skills/mobile-automator-generator'))).toBe(false);
    expect(fs.existsSync(path.join(dir, '.gemini/skills/mobile-automator-executor'))).toBe(false);

    const archived = fs.readdirSync(path.join(dir, '.gemini/skills/.archive'));
    expect(archived.some(name => /^generator-platform-aware-/.test(name))).toBe(true);
    expect(archived.some(name => /^executor-platform-aware-/.test(name))).toBe(true);
  });

  it('numeric-suffixes if archive target already exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-'));
    setupSkills(dir);
    archiveExistingSkills(dir, 'platform-aware');

    setupSkills(dir);
    archiveExistingSkills(dir, 'platform-aware');

    const archived = fs.readdirSync(path.join(dir, '.gemini/skills/.archive'));
    const generators = archived.filter(n => n.startsWith('generator-'));
    expect(generators.length).toBe(2);
    expect(generators.some(n => /-2$/.test(n))).toBe(true);
  });

  it('is a no-op if no skills exist', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-'));
    expect(() => archiveExistingSkills(dir, 'platform-aware')).not.toThrow();
  });
});
