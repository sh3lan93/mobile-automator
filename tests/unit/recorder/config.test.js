'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { loadProjectConfig, resolveModeAndDefaults } = require('../../../tools/recorder/src/config');

describe('recorder/config', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recorder-cfg-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('loads mode from mobile-automator/config.json', () => {
    fs.mkdirSync(path.join(tmpDir, 'mobile-automator'));
    fs.writeFileSync(
      path.join(tmpDir, 'mobile-automator/config.json'),
      JSON.stringify({ mode: 'platform-agnostic', project_name: 'demo' })
    );
    const cfg = loadProjectConfig(tmpDir);
    expect(cfg.mode).toBe('platform-agnostic');
    expect(cfg.project_name).toBe('demo');
  });

  test('treats missing mode field as platform-aware (back-compat)', () => {
    fs.mkdirSync(path.join(tmpDir, 'mobile-automator'));
    fs.writeFileSync(
      path.join(tmpDir, 'mobile-automator/config.json'),
      JSON.stringify({ project_name: 'demo' })
    );
    const cfg = loadProjectConfig(tmpDir);
    const resolved = resolveModeAndDefaults(cfg);
    expect(resolved.mode).toBe('platform-aware');
  });

  test('throws if config.json is missing', () => {
    expect(() => loadProjectConfig(tmpDir)).toThrow(/config\.json not found/);
  });
});
