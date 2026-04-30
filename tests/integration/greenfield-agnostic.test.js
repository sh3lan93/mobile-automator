// tests/integration/greenfield-agnostic.test.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'install-skills.js');

describe('Greenfield agnostic install', () => {
  it('produces valid agnostic skills in an empty project', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'greenfield-'));
    fs.mkdirSync(path.join(dir, 'mobile-automator'), { recursive: true });
    const state = {
      selected_mode: 'platform-agnostic',
      knowledge: {
        project_name: 'Sample',
        business_domain: 'Sample mobile app for testing',
        business_critical_paths: 'login, checkout',
        loading_indicators: 'a centered spinner overlay',
        protected_directories: 'src/main, lib',
        additional_resources: '',
      },
    };
    fs.writeFileSync(
      path.join(dir, 'mobile-automator', 'setup_state.json'),
      JSON.stringify(state)
    );

    const r = spawnSync('node', [SCRIPT, '--mode=platform-agnostic'], {
      cwd: dir,
      encoding: 'utf8',
    });

    expect(r.status).toBe(0);
    const skillPath = path.join(dir, '.gemini/skills/mobile-automator-generator/SKILL.md');
    expect(fs.existsSync(skillPath)).toBe(true);
    const content = fs.readFileSync(skillPath, 'utf8');
    expect(content).not.toMatch(/\{\{[a-z_]+\}\}/);  // no leaks
    expect(content).not.toMatch(/\bAndroid\b/i);
    expect(content).not.toMatch(/\biOS\b/i);

    expect(fs.existsSync(
      path.join(dir, '.gemini/skills/references/platform-resolutions.md')
    )).toBe(true);
  });
});
