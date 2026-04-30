// tests/integration/migration-rollback.test.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'install-skills.js');

describe('Migration rollback (manual restore)', () => {
  it('archive + backup + manual mv restores the project byte-identical', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-rb-'));
    fs.mkdirSync(path.join(dir, 'mobile-automator'), { recursive: true });
    const origConfig = { project_name: 'Sample', platform: 'android', mode_implicit: 'aware' };
    fs.writeFileSync(path.join(dir, 'mobile-automator/config.json'), JSON.stringify(origConfig, null, 2));
    fs.mkdirSync(path.join(dir, '.gemini/skills/mobile-automator-generator'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.gemini/skills/mobile-automator-executor'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.gemini/skills/mobile-automator-generator/SKILL.md'), 'aware content');
    fs.writeFileSync(path.join(dir, '.gemini/skills/mobile-automator-executor/SKILL.md'), 'aware content');

    const before = {
      config: fs.readFileSync(path.join(dir, 'mobile-automator/config.json')),
      gen: fs.readFileSync(path.join(dir, '.gemini/skills/mobile-automator-generator/SKILL.md')),
      exec: fs.readFileSync(path.join(dir, '.gemini/skills/mobile-automator-executor/SKILL.md')),
    };

    // Phase 2: backup + archive
    spawnSync('node', [SCRIPT, 'migrate-helpers', '--old-mode=platform-aware'], { cwd: dir, encoding: 'utf8' });

    // Manual restore (the documented TROUBLESHOOTING.md procedure)
    const archiveDir = fs.readdirSync(path.join(dir, '.gemini/skills/.archive'));
    const genArchive = archiveDir.find(n => n.startsWith('generator-'));
    const execArchive = archiveDir.find(n => n.startsWith('executor-'));
    fs.renameSync(
      path.join(dir, '.gemini/skills/.archive', genArchive),
      path.join(dir, '.gemini/skills/mobile-automator-generator')
    );
    fs.renameSync(
      path.join(dir, '.gemini/skills/.archive', execArchive),
      path.join(dir, '.gemini/skills/mobile-automator-executor')
    );
    fs.copyFileSync(
      path.join(dir, 'mobile-automator/config.json.platform-aware.bak'),
      path.join(dir, 'mobile-automator/config.json')
    );

    const after = {
      config: fs.readFileSync(path.join(dir, 'mobile-automator/config.json')),
      gen: fs.readFileSync(path.join(dir, '.gemini/skills/mobile-automator-generator/SKILL.md')),
      exec: fs.readFileSync(path.join(dir, '.gemini/skills/mobile-automator-executor/SKILL.md')),
    };
    expect(after.config.equals(before.config)).toBe(true);
    expect(after.gen.equals(before.gen)).toBe(true);
    expect(after.exec.equals(before.exec)).toBe(true);
  });
});
