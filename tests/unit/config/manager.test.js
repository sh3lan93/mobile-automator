'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

const { load, resolveMode, get, set } = require('../../../src/config/manager');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-cfg-'));
}

function configPath(root) {
  return path.join(root, 'mobile-automator', 'config.json');
}

describe('config/manager', () => {
  describe('load', () => {
    it('returns null when no config file exists', () => {
      const root = tmpRoot();
      expect(load(root)).toBeNull();
    });

    it('returns the parsed config object when present', () => {
      const root = tmpRoot();
      fs.mkdirSync(path.join(root, 'mobile-automator'), { recursive: true });
      fs.writeFileSync(configPath(root), JSON.stringify({ mode: 'platform-agnostic', app_package: 'com.x' }));
      expect(load(root)).toEqual({ mode: 'platform-agnostic', app_package: 'com.x' });
    });

    it('heals a legacy comma-joined list key on read (#136)', () => {
      const root = tmpRoot();
      fs.mkdirSync(path.join(root, 'mobile-automator'), { recursive: true });
      fs.writeFileSync(
        configPath(root),
        JSON.stringify({ mode: 'platform-aware', environments: 'stagingDebug,productionRelease' })
      );
      expect(load(root).environments).toEqual(['stagingDebug', 'productionRelease']);
    });

    it('heals a nested legacy list key on read', () => {
      const root = tmpRoot();
      fs.mkdirSync(path.join(root, 'mobile-automator'), { recursive: true });
      fs.writeFileSync(
        configPath(root),
        JSON.stringify({ knowledge: { business_critical_paths: 'login, checkout' } })
      );
      expect(load(root).knowledge.business_critical_paths).toEqual(['login', 'checkout']);
    });
  });

  describe('resolveMode', () => {
    it('defaults to platform-aware for null/empty config', () => {
      expect(resolveMode(null)).toBe('platform-aware');
      expect(resolveMode({})).toBe('platform-aware');
      expect(resolveMode(undefined)).toBe('platform-aware');
    });

    it('returns the explicit mode when set', () => {
      expect(resolveMode({ mode: 'platform-agnostic' })).toBe('platform-agnostic');
      expect(resolveMode({ mode: 'platform-aware' })).toBe('platform-aware');
    });
  });

  describe('get', () => {
    it('returns undefined when config is absent', () => {
      const root = tmpRoot();
      expect(get(root, 'app_package')).toBeUndefined();
    });

    it('returns a top-level value', () => {
      const root = tmpRoot();
      set(root, 'app_package', 'com.example');
      expect(get(root, 'app_package')).toBe('com.example');
    });

    it('returns a dotted-path nested value', () => {
      const root = tmpRoot();
      set(root, 'project.business_critical_paths', ['checkout']);
      expect(get(root, 'project.business_critical_paths')).toEqual(['checkout']);
    });

    it('returns undefined for a missing dotted path', () => {
      const root = tmpRoot();
      set(root, 'a.b', 1);
      expect(get(root, 'a.c')).toBeUndefined();
      expect(get(root, 'x.y.z')).toBeUndefined();
    });
  });

  describe('set', () => {
    it('round-trips set then get', () => {
      const root = tmpRoot();
      set(root, 'mode', 'platform-agnostic');
      expect(get(root, 'mode')).toBe('platform-agnostic');
    });

    it('creates the mobile-automator directory when missing', () => {
      const root = tmpRoot();
      set(root, 'mode', 'platform-aware');
      expect(fs.existsSync(configPath(root))).toBe(true);
    });

    it('preserves sibling fields when setting another key', () => {
      const root = tmpRoot();
      set(root, 'mode', 'platform-agnostic');
      set(root, 'app_package', 'com.example.app');
      const cfg = load(root);
      expect(cfg.mode).toBe('platform-agnostic');
      expect(cfg.app_package).toBe('com.example.app');
    });

    it('preserves siblings when setting a nested dotted path', () => {
      const root = tmpRoot();
      set(root, 'project.name', 'Demo');
      set(root, 'project.domain', 'fintech');
      const cfg = load(root);
      expect(cfg.project).toEqual({ name: 'Demo', domain: 'fintech' });
    });

    it('writes pretty 2-space JSON', () => {
      const root = tmpRoot();
      set(root, 'mode', 'platform-aware');
      const raw = fs.readFileSync(configPath(root), 'utf8');
      expect(raw).toContain('\n  "mode"');
    });
  });

  describe('self-repair', () => {
    it('rewrites a legacy string list as an array on the next set', () => {
      const root = tmpRoot();
      fs.mkdirSync(path.join(root, 'mobile-automator'), { recursive: true });
      fs.writeFileSync(configPath(root), JSON.stringify({ environments: 'a,b' }));
      set(root, 'project_name', 'Demo'); // touching an unrelated key is enough
      const raw = JSON.parse(fs.readFileSync(configPath(root), 'utf8'));
      expect(raw.environments).toEqual(['a', 'b']);
      expect(raw.project_name).toBe('Demo');
    });
  });
});
