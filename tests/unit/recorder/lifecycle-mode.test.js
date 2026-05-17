'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { runScriptedSession } = require('../../../tools/recorder/src/lifecycle');

function tmpProject(mode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-mode-'));
  fs.mkdirSync(path.join(root, 'mobile-automator'));
  fs.writeFileSync(
    path.join(root, 'mobile-automator/config.json'),
    JSON.stringify({ mode, project_name: 'demo' })
  );
  return root;
}

describe('runScriptedSession mode threading', () => {
  test('metadata.json records the config.json mode (agnostic)', async () => {
    const root = tmpProject('platform-agnostic');
    const script = { hierarchy_snapshots: [], tap_events: [] };
    await runScriptedSession({ projectRoot: root, scenarioId: 's', script });
    const meta = JSON.parse(
      fs.readFileSync(path.join(root, 'mobile-automator/.recorder/s/metadata.json'), 'utf8')
    );
    expect(meta.mode).toBe('platform-agnostic');
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('defaults to platform-aware when mode absent', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-mode-'));
    fs.mkdirSync(path.join(root, 'mobile-automator'));
    fs.writeFileSync(path.join(root, 'mobile-automator/config.json'), JSON.stringify({ project_name: 'd' }));
    await runScriptedSession({ projectRoot: root, scenarioId: 's', script: { hierarchy_snapshots: [], tap_events: [] } });
    const meta = JSON.parse(fs.readFileSync(path.join(root, 'mobile-automator/.recorder/s/metadata.json'), 'utf8'));
    expect(meta.mode).toBe('platform-aware');
    fs.rmSync(root, { recursive: true, force: true });
  });
});
