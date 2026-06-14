'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

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
      expect(fs.existsSync(path.join(root, 'mobile-automator', d))).toBe(true);
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
    fs.mkdirSync(path.join(root, 'mobile-automator'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'mobile-automator', 'config.json'),
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
