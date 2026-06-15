'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { interpolate, PLACEHOLDER_KEYS, FALLBACK } = require('../../../src/guide/placeholders');

function tmpProject(config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-ph-'));
  if (config) {
    const dir = path.join(root, 'mobile-automator');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2));
  }
  return root;
}

describe('guide/placeholders', () => {
  it('exports a placeholder -> config-key map for downstream slices', () => {
    expect(PLACEHOLDER_KEYS).toBeDefined();
    expect(typeof PLACEHOLDER_KEYS).toBe('object');
    // a few representative keys must be present
    for (const k of ['project_name', 'app_package', 'environments', 'protected_directories']) {
      expect(Object.prototype.hasOwnProperty.call(PLACEHOLDER_KEYS, k)).toBe(true);
    }
  });

  it('fills tokens from config (flat agnostic shape)', () => {
    const root = tmpProject({
      mode: 'platform-agnostic',
      project_name: 'Acme',
      business_domain: 'banking',
      business_critical_paths: ['login', 'transfer'],
      loading_indicators: 'a spinner',
      protected_directories: ['app/src'],
    });
    const out = interpolate('{{project_name}} / {{business_domain}}', { projectRoot: root, mode: 'platform-agnostic' });
    expect(out).toBe('Acme / banking');
  });

  it('joins array-valued config into a comma list', () => {
    const root = tmpProject({
      mode: 'platform-agnostic',
      business_critical_paths: ['login', 'transfer', 'logout'],
      protected_directories: ['a', 'b'],
    });
    expect(interpolate('{{business_critical_paths}}', { projectRoot: root, mode: 'platform-agnostic' }))
      .toBe('login, transfer, logout');
    expect(interpolate('{{protected_directories}}', { projectRoot: root, mode: 'platform-agnostic' }))
      .toBe('a, b');
  });

  it('app_package resolves from android_package or ios_bundle_id', () => {
    const androidRoot = tmpProject({ mode: 'platform-aware', android_package: 'com.x.android' });
    expect(interpolate('{{app_package}}', { projectRoot: androidRoot, mode: 'platform-aware' }))
      .toBe('com.x.android');

    const iosRoot = tmpProject({ mode: 'platform-aware', ios_bundle_id: 'com.x.ios' });
    expect(interpolate('{{app_package}}', { projectRoot: iosRoot, mode: 'platform-aware' }))
      .toBe('com.x.ios');
  });

  it('reads nested app.* / knowledge.* config shape (setup.toml shape)', () => {
    const root = tmpProject({
      mode: 'platform-aware',
      app: { android_package: 'com.nested.app' },
      knowledge: { project_name: 'NestedName' },
    });
    expect(interpolate('{{project_name}}', { projectRoot: root, mode: 'platform-aware' })).toBe('NestedName');
    expect(interpolate('{{app_package}}', { projectRoot: root, mode: 'platform-aware' })).toBe('com.nested.app');
  });

  it('uses the fallback for missing keys and leaves no {{ token behind', () => {
    const root = tmpProject(null); // no config at all
    const tpl = '{{project_name}} {{architecture}} {{build_command}} {{app_package}} {{additional_resources}}';
    const out = interpolate(tpl, { projectRoot: root, mode: 'platform-aware' });
    expect(out).not.toContain('{{');
    expect(out).toContain(FALLBACK);
  });

  it('never leaves a {{ token for any known placeholder, even with empty config', () => {
    const root = tmpProject({});
    const tpl = Object.keys(PLACEHOLDER_KEYS).map((k) => `{{${k}}}`).join(' ');
    const out = interpolate(tpl, { projectRoot: root, mode: 'platform-aware' });
    expect(out).not.toContain('{{');
  });

  it('replaces unknown {{tokens}} too so no token can survive', () => {
    const root = tmpProject({});
    const out = interpolate('{{totally_unknown_token}}', { projectRoot: root, mode: 'platform-aware' });
    expect(out).not.toContain('{{');
  });
});
