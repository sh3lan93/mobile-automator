'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { runScriptedSession } = require('../../../tools/recorder/src/lifecycle');

function project(mode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-agn-'));
  fs.mkdirSync(path.join(root, 'mobile-automator'));
  fs.writeFileSync(path.join(root, 'mobile-automator/config.json'), JSON.stringify({ mode, project_name: 'd' }));
  return root;
}

function readEvents(root, sid) {
  return fs.readFileSync(path.join(root, `mobile-automator/.recorder/${sid}/events.jsonl`), 'utf8')
    .trim().split('\n').map(JSON.parse);
}

const PERM_SNAP = {
  t: 0,
  elements: [
    { type: 'android.widget.Button', bounds: [340, 1400, 600, 1480], text: 'Allow',
      resource_id: 'com.android.permissioncontroller:id/permission_allow_button' },
  ],
};

const script = {
  hierarchy_snapshots: [PERM_SNAP],
  tap_events: [
    { kind: 'down', t: 100, x: 470, y: 1440 },
    { kind: 'up', t: 150, x: 470, y: 1440 },
  ],
  key_events: [
    { key: 'BACK', state: 'down', t_seconds: 0.300 },
    { key: 'BACK', state: 'up', t_seconds: 0.320 },
  ],
};

describe('agnostic emit integration', () => {
  test('agnostic: BACK -> press_back, permission tap -> grant_permission', async () => {
    const root = project('platform-agnostic');
    await runScriptedSession({ projectRoot: root, scenarioId: 's', script });
    const kinds = readEvents(root, 's').map((e) => e.kind);
    expect(kinds).toContain('press_back');
    expect(kinds).toContain('grant_permission');
    expect(kinds).not.toContain('press_button');
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('aware: same script stays press_button + tap (regression guard)', async () => {
    const root = project('platform-aware');
    await runScriptedSession({ projectRoot: root, scenarioId: 's', script });
    const kinds = readEvents(root, 's').map((e) => e.kind);
    expect(kinds).toContain('press_button');
    expect(kinds).toContain('tap');
    expect(kinds).not.toContain('press_back');
    expect(kinds).not.toContain('grant_permission');
    fs.rmSync(root, { recursive: true, force: true });
  });
});
