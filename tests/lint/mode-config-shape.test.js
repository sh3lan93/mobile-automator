// tests/lint/mode-config-shape.test.js
const fs = require('fs');
const path = require('path');

const FIX = path.resolve(__dirname, '..', 'fixtures');

describe('config.json shape per mode', () => {
  const aware = JSON.parse(fs.readFileSync(path.join(FIX, 'config.platform-aware.json'), 'utf8'));
  const agnostic = JSON.parse(fs.readFileSync(path.join(FIX, 'config.platform-agnostic.json'), 'utf8'));

  it('aware mode has the documented field set', () => {
    // Top-level shape matches what setup.toml § 7.2 actually writes
    expect(Object.keys(aware).sort()).toEqual([
      'app', 'created_at', 'default_environment', 'environments',
      'knowledge', 'mode', 'platform', 'screenshot_settings', 'version',
    ]);
    expect(aware.mode).toBe('platform-aware');
    // Nested app shape
    expect(Object.keys(aware.app).sort()).toEqual([
      'android_package', 'android_packages', 'ios_bundle_id', 'ios_bundle_ids',
    ]);
    // Nested knowledge shape
    expect(Object.keys(aware.knowledge).sort()).toEqual([
      'architecture', 'build_command', 'business_critical_paths',
      'business_domain', 'project_name',
    ]);
    // screenshot_settings shape
    expect(Object.keys(aware.screenshot_settings).sort()).toEqual([
      'default_tolerance', 'format',
    ]);
  });

  it('agnostic mode has the documented flat field set', () => {
    // Agnostic config (§ A.7) uses a flat shape — no nested app/knowledge blocks
    const expected = [
      'android_package', 'business_critical_paths', 'business_domain',
      'default_environment', 'environments', 'ios_bundle_id',
      'loading_indicators', 'mode', 'project_name', 'protected_directories',
    ];
    expect(Object.keys(agnostic).sort()).toEqual(expected);
    expect(agnostic.mode).toBe('platform-agnostic');
  });

  it('agnostic does NOT include aware-only top-level keys', () => {
    // Aware-only concerns live inside app{} and knowledge{} — not at root in either shape.
    // The agnostic root should not expose nested aware-only sub-objects.
    for (const f of ['app', 'knowledge', 'screenshot_settings', 'version', 'platform']) {
      expect(agnostic[f]).toBeUndefined();
    }
  });
});
