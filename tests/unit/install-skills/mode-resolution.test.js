// tests/unit/install-skills/mode-resolution.test.js
const path = require('path');
const fs = require('fs');
const os = require('os');

// We'll test by spawning the script with various flag/state combinations.
const { spawnSync } = require('child_process');
const SCRIPT = path.resolve(__dirname, '..', '..', '..', 'scripts', 'install-skills.js');

function makeProject(state, configMode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mode-res-'));
  fs.mkdirSync(path.join(dir, 'mobile-automator'), { recursive: true });
  if (state) {
    fs.writeFileSync(
      path.join(dir, 'mobile-automator', 'setup_state.json'),
      JSON.stringify(state)
    );
  }
  if (configMode !== undefined) {
    fs.writeFileSync(
      path.join(dir, 'mobile-automator', 'config.json'),
      JSON.stringify({ mode: configMode })
    );
  }
  return dir;
}

describe('install-skills.js mode resolution', () => {
  it('--mode=aware uses aware regardless of config or state', () => {
    const dir = makeProject({ knowledge: {} }, 'platform-agnostic');
    const r = spawnSync('node', [SCRIPT, '--mode=aware', '--dry-run'], {
      cwd: dir,
      encoding: 'utf8',
    });
    expect(r.stdout).toMatch(/mode\s*[:=]\s*platform-aware/i);
  });

  it('--mode=agnostic uses agnostic regardless of config or state', () => {
    const dir = makeProject({ knowledge: {} }, 'platform-aware');
    const r = spawnSync('node', [SCRIPT, '--mode=agnostic', '--dry-run'], {
      cwd: dir,
      encoding: 'utf8',
    });
    expect(r.stdout).toMatch(/mode\s*[:=]\s*platform-agnostic/i);
  });

  it('falls back to setup_state.selected_mode when no flag', () => {
    const dir = makeProject(
      { knowledge: {}, selected_mode: 'platform-agnostic' },
      undefined
    );
    const r = spawnSync('node', [SCRIPT, '--dry-run'], {
      cwd: dir,
      encoding: 'utf8',
    });
    expect(r.stdout).toMatch(/mode\s*[:=]\s*platform-agnostic/i);
  });

  it('falls back to config.mode when no flag and no setup_state.selected_mode', () => {
    const dir = makeProject({ knowledge: {} }, 'platform-agnostic');
    const r = spawnSync('node', [SCRIPT, '--dry-run'], {
      cwd: dir,
      encoding: 'utf8',
    });
    expect(r.stdout).toMatch(/mode\s*[:=]\s*platform-agnostic/i);
  });

  it('errors loud when no mode source is available', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mode-res-empty-'));
    const r = spawnSync('node', [SCRIPT, '--dry-run'], {
      cwd: dir,
      encoding: 'utf8',
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/cannot determine mode/i);
  });
});
