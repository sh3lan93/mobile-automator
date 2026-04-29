// tests/lint/mode-config-shape.test.js
const fs = require('fs');
const path = require('path');

const FIX = path.resolve(__dirname, '..', 'fixtures');

describe('config.json shape per mode', () => {
  const aware = JSON.parse(fs.readFileSync(path.join(FIX, 'config.platform-aware.json'), 'utf8'));
  const agnostic = JSON.parse(fs.readFileSync(path.join(FIX, 'config.platform-agnostic.json'), 'utf8'));

  it('aware mode has the documented field set', () => {
    expect(Object.keys(aware).sort()).toEqual([
      'android_package', 'architecture', 'build_command', 'build_system',
      'business_critical_paths', 'business_domain', 'default_environment',
      'environments', 'ios_bundle_id', 'loading_indicators', 'mode',
      'platform', 'platform_details', 'project_name', 'protected_directories',
    ]);
    expect(aware.mode).toBe('platform-aware');
  });

  it('agnostic mode is a strict subset of aware fields plus mode', () => {
    const expected = [
      'android_package', 'business_critical_paths', 'business_domain',
      'default_environment', 'environments', 'ios_bundle_id',
      'loading_indicators', 'mode', 'project_name', 'protected_directories',
    ];
    expect(Object.keys(agnostic).sort()).toEqual(expected);
    expect(agnostic.mode).toBe('platform-agnostic');
  });

  it('agnostic does NOT include aware-only fields', () => {
    for (const f of ['platform', 'platform_details', 'build_system', 'build_command', 'architecture']) {
      expect(agnostic[f]).toBeUndefined();
    }
  });
});
