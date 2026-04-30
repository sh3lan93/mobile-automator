// tests/integration/migration-aware-to-agnostic.test.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'install-skills.js');
const FIXTURES = path.resolve(__dirname, '..', 'fixtures', 'scenarios');

function setupV010Project(dir) {
  fs.mkdirSync(path.join(dir, 'mobile-automator/scenarios'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'mobile-automator/config.json'),
    JSON.stringify({
      project_name: 'Sample',
      platform: 'android',
      build_command: './gradlew assembleStaging',
      android_package: 'com.example.app',
      business_domain: 'Sample app',
      business_critical_paths: 'login, checkout',
      loading_indicators: 'CircularProgressIndicator',
      protected_directories: 'app/src',
    }, null, 2)
  );
  // pre-existing skills (stand-ins)
  fs.mkdirSync(path.join(dir, '.gemini/skills/mobile-automator-generator'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.gemini/skills/mobile-automator-executor'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.gemini/skills/mobile-automator-generator/SKILL.md'), 'old aware content');
  fs.writeFileSync(path.join(dir, '.gemini/skills/mobile-automator-executor/SKILL.md'), 'old aware content');
  // a scenario with platform-specific action
  fs.copyFileSync(path.join(FIXTURES, 'scenario-with-back.json'), path.join(dir, 'mobile-automator/scenarios/scenario-with-back.json'));
}

describe('Migration aware → agnostic', () => {
  it('archives skills, backs up config, lints scenarios, and installs new skills', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-fwd-'));
    setupV010Project(dir);

    // Phase 2: backup + archive
    const phase2 = spawnSync('node', [SCRIPT, 'migrate-helpers', '--old-mode=platform-aware'], {
      cwd: dir,
      encoding: 'utf8',
    });
    expect(phase2.status).toBe(0);
    expect(phase2.stdout).toMatch(/Lint findings.*1/);
    expect(fs.existsSync(path.join(dir, 'mobile-automator/config.json.platform-aware.bak'))).toBe(true);
    const archiveContents = fs.readdirSync(path.join(dir, '.gemini/skills/.archive'));
    expect(archiveContents.some(n => n.startsWith('generator-platform-aware-'))).toBe(true);

    // Original scenarios untouched
    const sc = JSON.parse(fs.readFileSync(path.join(dir, 'mobile-automator/scenarios/scenario-with-back.json'), 'utf8'));
    expect(sc.steps[1].action).toBe('press_button');  // not rewritten

    // Phase 3: pre-fill setup state and install agnostic skills
    fs.writeFileSync(path.join(dir, 'mobile-automator/setup_state.json'), JSON.stringify({
      selected_mode: 'platform-agnostic',
      is_mode_switch: true,
      knowledge: {
        project_name: 'Sample',
        business_domain: 'Sample app',
        business_critical_paths: 'login, checkout',
        loading_indicators: 'a centered spinner overlay',  // re-asked
        protected_directories: 'app/src, lib',
        additional_resources: '',
      },
    }));
    const phase3 = spawnSync('node', [SCRIPT, '--mode=platform-agnostic'], { cwd: dir, encoding: 'utf8' });
    expect(phase3.status).toBe(0);
    const newSkill = fs.readFileSync(path.join(dir, '.gemini/skills/mobile-automator-generator/SKILL.md'), 'utf8');
    expect(newSkill).not.toMatch(/\{\{[a-z_]+\}\}/);
    expect(newSkill).not.toMatch(/\bAndroid\b/i);
  });
});
