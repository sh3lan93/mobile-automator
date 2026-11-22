'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const { scaffold, GITIGNORE_BODIES } = require('../../../src/setup/scaffold');
const { load, DEFAULT_MODE } = require('../../../src/config/manager');

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
    expect(r.modeChanged).toStrictEqual({ from: 'platform-aware', to: 'platform-agnostic' });
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

// #333: the platform-aware default is for a NEW workspace only. Re-running
// setup without a mode (the documented .gitignore migration path, #328) must
// not reset an existing workspace's mode.
describe('setup/scaffold mode on an existing workspace (#333)', () => {
  function existingConfig(cfg) {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, '.mobile-automator'), { recursive: true });
    const p = path.join(root, '.mobile-automator', 'config.json');
    fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
    return { root, p };
  }

  it('a new workspace with no mode gets DEFAULT_MODE', () => {
    const root = tmpRoot();
    const r = scaffold(root, {});
    expect(r.mode).toBe(DEFAULT_MODE);
    expect(r.modeChanged).toBeNull();
    expect(load(root).mode).toBe(DEFAULT_MODE);
  });

  it('no mode keeps an existing agnostic workspace agnostic and does not rewrite config.json', () => {
    const { root, p } = existingConfig({ mode: 'platform-agnostic', app_package: 'com.x' });
    const before = fs.readFileSync(p, 'utf8');
    const r = scaffold(root, {});
    expect(r.mode).toBe('platform-agnostic');
    expect(r.modeChanged).toBeNull();
    expect(fs.readFileSync(p, 'utf8')).toBe(before);
  });

  it('no mode on a config predating the mode field reports the resolved default and writes nothing', () => {
    const { root, p } = existingConfig({ app_package: 'com.x' });
    const before = fs.readFileSync(p, 'utf8');
    const r = scaffold(root, {});
    expect(r.mode).toBe(DEFAULT_MODE);
    expect(r.modeChanged).toBeNull();
    expect(fs.readFileSync(p, 'utf8')).toBe(before);
  });

  it('an explicit mode equal to the current one reports no change', () => {
    const { root } = existingConfig({ mode: 'platform-agnostic' });
    const r = scaffold(root, { mode: 'platform-agnostic' });
    expect(r.mode).toBe('platform-agnostic');
    expect(r.modeChanged).toBeNull();
  });

  it('an explicit mode on a config predating the field is stored but is not a change', () => {
    const { root } = existingConfig({ app_package: 'com.x' });
    const r = scaffold(root, { mode: DEFAULT_MODE });
    expect(r.modeChanged).toBeNull();
    expect(load(root).mode).toBe(DEFAULT_MODE);
  });

  it('an explicit different mode is written and reported as a change', () => {
    const { root } = existingConfig({ mode: 'platform-agnostic', app_package: 'com.x' });
    const r = scaffold(root, { mode: 'platform-aware' });
    expect(r.mode).toBe('platform-aware');
    expect(r.modeChanged).toStrictEqual({ from: 'platform-agnostic', to: 'platform-aware' });
    const cfg = load(root);
    expect(cfg.mode).toBe('platform-aware');
    expect(cfg.app_package).toBe('com.x');
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
    expect(body).toBe(GITIGNORE_BODIES[GITIGNORE_BODIES.length - 1]);
  });

  // Every body `mauto setup` has shipped, by SHA-256, oldest first. Appending a
  // new body to GITIGNORE_BODIES passes; editing or removing a shipped one
  // fails, because workspaces holding that body could no longer be upgraded.
  const SHIPPED_SHA256 = [
    '1f69ab7950cc2d711b34055c90968d9a5bde5107d8f1cd85a5162afaaf9d87bc', // 0.25.0 → 0.40.2
    '1d05ec4f470a448268a1e2e67d562d49d4550ee69bda72cf786db02d84cf38df', // 0.40.3 (#328)
  ];

  it('pins every shipped .gitignore body (append-only)', () => {
    const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
    const actual = GITIGNORE_BODIES.slice(0, SHIPPED_SHA256.length).map(sha);
    if (JSON.stringify(actual) !== JSON.stringify(SHIPPED_SHA256)) {
      throw new Error(
        'a shipped .gitignore body was edited or removed; append a new entry instead\n' +
          `expected: ${JSON.stringify(SHIPPED_SHA256)}\nactual:   ${JSON.stringify(actual)}`
      );
    }
    // Readable oracle for the first body ever shipped.
    expect(GITIGNORE_BODIES[0]).toBe(
      '# Managed by `mauto setup`. Runtime artifacts — not source.\n.session/\n.logs/\nscreenshots/\n'
    );
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

  for (const [i, shipped] of GITIGNORE_BODIES.slice(0, -1).entries()) {
    it(`upgrades a pristine .gitignore holding shipped body #${i}`, () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-scaffold-'));
      fs.mkdirSync(path.join(root, '.mobile-automator'), { recursive: true });
      const gi = path.join(root, '.mobile-automator', '.gitignore');
      fs.writeFileSync(gi, shipped);

      const { created, upgraded } = scaffold(root, { mode: 'platform-aware' });

      expect(fs.readFileSync(gi, 'utf8')).toBe(GITIGNORE_BODIES[GITIGNORE_BODIES.length - 1]);
      expect(upgraded).toEqual([gi]);
      expect(created).not.toContain(gi);
    });
  }

  it('leaves a .gitignore already holding the current body alone', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-scaffold-'));
    fs.mkdirSync(path.join(root, '.mobile-automator'), { recursive: true });
    const gi = path.join(root, '.mobile-automator', '.gitignore');
    const current = GITIGNORE_BODIES[GITIGNORE_BODIES.length - 1];
    fs.writeFileSync(gi, current);

    const { created, upgraded } = scaffold(root, { mode: 'platform-aware' });

    expect(fs.readFileSync(gi, 'utf8')).toBe(current);
    expect(upgraded).not.toContain(gi);
    expect(created).not.toContain(gi);
  });

  it('keeps an edited .gitignore byte-for-byte and does not upgrade it', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-scaffold-'));
    fs.mkdirSync(path.join(root, '.mobile-automator'), { recursive: true });
    const gi = path.join(root, '.mobile-automator', '.gitignore');
    const edited = '# mine\n.session/\nscreenshots/\n*.tmp\n';
    fs.writeFileSync(gi, edited);

    const { upgraded } = scaffold(root, { mode: 'platform-aware' });

    expect(fs.readFileSync(gi, 'utf8')).toBe(edited);
    expect(upgraded).toEqual([]);
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

// #347: a cloned repo can commit .mobile-automator/ (or any path under it) as
// a symlink. scaffold creates and writes only through safe-fs, so a link is
// refused with UnsafePathError and its target is never written or created.
describe('scaffold refuses a symlinked workspace path (#347)', () => {
  const { UnsafePathError } = require('../../../src/workspace/safe-fs');
  const { CANARY, tmpDir, snapshot } = require('../../helpers/workspace-safety');

  function project() {
    const base = tmpDir('mauto-scaffold-confine-');
    const root = path.join(base, 'project');
    const outside = path.join(base, 'outside');
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    return { root, ws: path.join(root, '.mobile-automator'), outside };
  }

  function scaffoldError(root) {
    try {
      scaffold(root, { mode: 'platform-aware' });
    } catch (err) {
      return err;
    }
    return undefined;
  }

  it('.mobile-automator -> outside dir is refused and nothing is created there', () => {
    const { root, ws, outside } = project();
    fs.symlinkSync(outside, ws);

    const err = scaffoldError(root);

    expect(err).toBeInstanceOf(UnsafePathError);
    expect(err.reason).toBe('symlink');
    expect(err.path).toBe(ws);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('.mobile-automator/screenshots -> outside dir is refused and the outside dir is unchanged', () => {
    const { root, ws, outside } = project();
    fs.writeFileSync(path.join(outside, 'keep.txt'), CANARY);
    fs.mkdirSync(ws);
    fs.symlinkSync(outside, path.join(ws, 'screenshots'));
    const before = snapshot(outside);

    const err = scaffoldError(root);

    expect(err).toBeInstanceOf(UnsafePathError);
    expect(err.path).toBe(path.join(ws, 'screenshots'));
    expect(snapshot(outside)).toEqual(before);
  });

  it('.gitignore -> outside file is refused and the file is unchanged', () => {
    const { root, ws, outside } = project();
    const target = path.join(outside, 'gitignore');
    fs.writeFileSync(target, `${CANARY}\n`);
    fs.mkdirSync(ws);
    fs.symlinkSync(target, path.join(ws, '.gitignore'));
    const before = snapshot(outside);

    const err = scaffoldError(root);

    expect(err).toBeInstanceOf(UnsafePathError);
    expect(err.path).toBe(path.join(ws, '.gitignore'));
    expect(err.message).not.toContain(CANARY);
    expect(snapshot(outside)).toEqual(before);
  });

  it('a dangling config.json symlink is refused and its target is not created', () => {
    const { root, ws, outside } = project();
    const target = path.join(outside, 'config.json');
    fs.mkdirSync(ws);
    fs.symlinkSync(target, path.join(ws, 'config.json'));

    const err = scaffoldError(root);

    expect(err).toBeInstanceOf(UnsafePathError);
    expect(err.reason).toBe('symlink');
    expect(err.path).toBe(path.join(ws, 'config.json'));
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('a fresh scaffold still reports the same created list', () => {
    const { root, ws } = project();

    const { created } = scaffold(root, { mode: 'platform-aware' });

    expect(created).toEqual([
      ws,
      path.join(ws, 'scenarios'),
      path.join(ws, 'screenshots'),
      path.join(ws, 'results'),
      path.join(ws, 'memory'),
      path.join(ws, '.gitignore'),
      path.join(ws, 'config.json'),
    ]);
    // A rerun creates nothing.
    expect(scaffold(root, { mode: 'platform-aware' }).created).toEqual([]);
  });
});
