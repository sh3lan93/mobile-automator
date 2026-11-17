'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { scaffold } = require('../../../src/setup/scaffold');
const { load } = require('../../../src/config/manager');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-scaffold-'));
}

describe('setup/scaffold', () => {
  it('creates scenarios, screenshots and results directories', () => {
    const root = tmpRoot();
    scaffold(root, { mode: 'platform-aware' });
    for (const d of ['scenarios', 'screenshots', 'results']) {
      expect(fs.existsSync(path.join(root, '.mobile-automator', d))).toBe(true);
    }
  });

  it('writes a skeleton config with the requested mode when absent', () => {
    const root = tmpRoot();
    const r = scaffold(root, { mode: 'platform-agnostic' });
    expect(r.configWritten).toBe(true);
    const cfg = load(root);
    expect(cfg).toEqual({
      mode: 'platform-agnostic',
      project_name: null,
      environments: [],
      default_environment: null,
      telemetry: { enabled: false },
    });
  });

  it('returns created paths and mode', () => {
    const root = tmpRoot();
    const r = scaffold(root, { mode: 'platform-aware' });
    expect(r.mode).toBe('platform-aware');
    expect(Array.isArray(r.created)).toBe(true);
    expect(r.created.length).toBeGreaterThan(0);
  });

  it('does not clobber an existing config but sets the mode', () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, '.mobile-automator'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.mobile-automator', 'config.json'),
      JSON.stringify({ mode: 'platform-aware', project_name: 'Existing', app_package: 'com.x' })
    );
    const r = scaffold(root, { mode: 'platform-agnostic' });
    expect(r.configWritten).toBe(false);
    const cfg = load(root);
    expect(cfg.project_name).toBe('Existing');
    expect(cfg.app_package).toBe('com.x');
    expect(cfg.mode).toBe('platform-agnostic');
  });

  it('is idempotent (re-run is safe and preserves config)', () => {
    const root = tmpRoot();
    scaffold(root, { mode: 'platform-agnostic' });
    set_app_package(root);
    const r2 = scaffold(root, { mode: 'platform-agnostic' });
    expect(r2.configWritten).toBe(false);
    const cfg = load(root);
    expect(cfg.app_package).toBe('com.example');
    expect(cfg.mode).toBe('platform-agnostic');
  });
});

function set_app_package(root) {
  const { set } = require('../../../src/config/manager');
  set(root, 'app_package', 'com.example');
}

describe('workspace .gitignore', () => {
  it('writes .mobile-automator/.gitignore covering the runtime dirs', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-scaffold-'));
    scaffold(root, { mode: 'platform-aware' });

    const gi = path.join(root, '.mobile-automator', '.gitignore');
    const body = fs.readFileSync(gi, 'utf8');
    expect(body).toContain('.session/');
    expect(body).toContain('.logs/');
    const lines = body.split('\n');
    expect(lines).toContain('screenshots/*');
    expect(lines).toContain('!screenshots/reference/');
    expect(lines).not.toContain('screenshots/');
  });

  it('reports upgraded as an empty array on a fresh scaffold', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-scaffold-'));
    const { upgraded } = scaffold(root, { mode: 'platform-aware' });
    expect(upgraded).toEqual([]);
  });

  it('keeps reference baselines tracked while ignoring run artifacts (real git)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-scaffold-git-'));
    execFileSync('git', ['init', '-q'], { cwd: root });
    scaffold(root, { mode: 'platform-aware' });

    const ws = path.join(root, '.mobile-automator');
    const files = {
      reference: 'screenshots/reference/s1/a1.png',
      actual: 'screenshots/s1/run_x/assert_a1.png',
      diff: 'screenshots/assert/assert_x/diff.png',
      log: '.session/daemon.log',
    };
    for (const rel of Object.values(files)) {
      const abs = path.join(ws, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, 'x');
    }
    const ignored = (rel) => {
      try {
        execFileSync('git', ['check-ignore', '-q', path.join('.mobile-automator', rel)], { cwd: root });
        return true;
      } catch (err) {
        if (err.status === 1) return false;
        throw err;
      }
    };
    expect(ignored(files.reference)).toBe(false);
    expect(ignored(files.actual)).toBe(true);
    expect(ignored(files.diff)).toBe(true);
    expect(ignored(files.log)).toBe(true);

    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' });
    expect(status).toContain(`.mobile-automator/${files.reference}`);
    expect(status).not.toContain(`.mobile-automator/${files.actual}`);
  });

  it('upgrades a pristine .gitignore that an earlier mauto setup wrote', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-scaffold-'));
    fs.mkdirSync(path.join(root, '.mobile-automator'), { recursive: true });
    const gi = path.join(root, '.mobile-automator', '.gitignore');
    const legacy = '# Managed by `mauto setup`. Runtime artifacts — not source.\n.session/\n.logs/\nscreenshots/\n';
    fs.writeFileSync(gi, legacy);

    const { created, upgraded } = scaffold(root, { mode: 'platform-aware' });

    const body = fs.readFileSync(gi, 'utf8');
    expect(body).not.toBe(legacy);
    expect(body.split('\n')).toContain('!screenshots/reference/');
    expect(upgraded).toEqual([gi]);
    expect(created).not.toContain(gi);
  });

  it('keeps an edited .gitignore that still ignores screenshots/ and flags it', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-scaffold-'));
    fs.mkdirSync(path.join(root, '.mobile-automator'), { recursive: true });
    const gi = path.join(root, '.mobile-automator', '.gitignore');
    const edited = '# mine\n.session/\nscreenshots/\n*.tmp\n';
    fs.writeFileSync(gi, edited);

    const { upgraded, gitignoreIgnoresReferences } = scaffold(root, { mode: 'platform-aware' });

    expect(fs.readFileSync(gi, 'utf8')).toBe(edited);
    expect(upgraded).toEqual([]);
    expect(gitignoreIgnoresReferences).toBe(true);
  });

  it('does not flag an edited .gitignore that re-includes the baselines', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-scaffold-'));
    fs.mkdirSync(path.join(root, '.mobile-automator'), { recursive: true });
    const gi = path.join(root, '.mobile-automator', '.gitignore');
    fs.writeFileSync(gi, 'screenshots/\n!screenshots/reference/\n');

    const { gitignoreIgnoresReferences } = scaffold(root, { mode: 'platform-aware' });
    expect(gitignoreIgnoresReferences).toBe(false);
  });

  it('reports the .gitignore in created[] on first write', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-scaffold-'));
    const { created } = scaffold(root, { mode: 'platform-aware' });
    expect(created.some((p) => p.endsWith(path.join('.mobile-automator', '.gitignore')))).toBe(true);
  });

  it('never clobbers a .gitignore the user has edited', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-scaffold-'));
    fs.mkdirSync(path.join(root, '.mobile-automator'), { recursive: true });
    const gi = path.join(root, '.mobile-automator', '.gitignore');
    fs.writeFileSync(gi, '# mine\n');

    scaffold(root, { mode: 'platform-aware' });

    expect(fs.readFileSync(gi, 'utf8')).toBe('# mine\n');
    expect(scaffold(root, { mode: 'platform-aware' }).gitignoreIgnoresReferences).toBe(false);
  });
});

describe('telemetry default', () => {
  it('writes a visible false rather than relying on an absent key', () => {
    const root = tmpRoot();
    scaffold(root, { mode: 'platform-aware' });
    const cfg = JSON.parse(fs.readFileSync(path.join(root, '.mobile-automator', 'config.json'), 'utf8'));
    expect(cfg.telemetry).toEqual({ enabled: false });
  });

  it('never rewrites an existing config\'s telemetry choice', () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, '.mobile-automator'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.mobile-automator', 'config.json'),
      JSON.stringify({ mode: 'platform-aware', telemetry: { enabled: true } }, null, 2)
    );
    scaffold(root, { mode: 'platform-agnostic' });
    const cfg = JSON.parse(fs.readFileSync(path.join(root, '.mobile-automator', 'config.json'), 'utf8'));
    // Re-running setup must not silently revoke — or silently grant — consent.
    expect(cfg.telemetry.enabled).toBe(true);
    expect(cfg.mode).toBe('platform-agnostic');
  });
});
