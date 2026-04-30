// tests/unit/install-skills/backup-config.test.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { backupConfig } = require('../../../scripts/install-skills.js');

function setupConfig(workspace, content) {
  fs.mkdirSync(path.join(workspace, 'mobile-automator'), { recursive: true });
  fs.writeFileSync(
    path.join(workspace, 'mobile-automator', 'config.json'),
    JSON.stringify(content)
  );
}

describe('backupConfig', () => {
  it('creates config.json.<oldMode>.bak alongside the original', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
    setupConfig(dir, { mode: 'platform-aware' });

    backupConfig(dir, 'platform-aware');

    const bak = path.join(dir, 'mobile-automator', 'config.json.platform-aware.bak');
    expect(fs.existsSync(bak)).toBe(true);
    const content = JSON.parse(fs.readFileSync(bak, 'utf8'));
    expect(content.mode).toBe('platform-aware');
    // original still in place
    expect(fs.existsSync(path.join(dir, 'mobile-automator', 'config.json'))).toBe(true);
  });

  it('numeric-suffixes if .bak already exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
    setupConfig(dir, { mode: 'platform-aware' });
    backupConfig(dir, 'platform-aware');
    backupConfig(dir, 'platform-aware');
    const baks = fs.readdirSync(path.join(dir, 'mobile-automator'))
      .filter(f => /platform-aware\.bak/.test(f));
    expect(baks.length).toBe(2);
  });

  it('is a no-op if no config exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
    expect(() => backupConfig(dir, 'platform-aware')).not.toThrow();
  });
});
