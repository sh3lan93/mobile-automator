'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { runScriptedSession } = require('../../../tools/recorder/src/lifecycle');

describe('capture pipeline integration', () => {
  test('scripted session produces expected events.jsonl', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-int-'));
    fs.mkdirSync(path.join(tmp, 'mobile-automator'));
    fs.writeFileSync(path.join(tmp, 'mobile-automator/config.json'), JSON.stringify({ mode: 'platform-aware', project_name: 'demo' }));

    const script = JSON.parse(fs.readFileSync(path.join(__dirname, '../../fixtures/recorder/scripted-session.json'), 'utf8'));
    await runScriptedSession({ projectRoot: tmp, scenarioId: 's', script });

    const events = fs.readFileSync(path.join(tmp, 'mobile-automator/.recorder/s/events.jsonl'), 'utf8');
    const lines = events.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((e) => e.kind)).toContain('tap');
    expect(lines.find((e) => e.kind === 'tap').step_id).toMatch(/^tap_/);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('scripted session coalesces keyboard taps into a single type event', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-int-'));
    fs.mkdirSync(path.join(tmp, 'mobile-automator'));
    fs.writeFileSync(path.join(tmp, 'mobile-automator/config.json'), JSON.stringify({ mode: 'platform-aware', project_name: 'demo' }));

    const script = JSON.parse(fs.readFileSync(path.join(__dirname, '../../fixtures/recorder/scripted-session.json'), 'utf8'));
    await runScriptedSession({ projectRoot: tmp, scenarioId: 's', script });

    const events = fs.readFileSync(path.join(tmp, 'mobile-automator/.recorder/s/events.jsonl'), 'utf8');
    const lines = events.trim().split('\n').map((l) => JSON.parse(l));

    const typeEvents = lines.filter((e) => e.kind === 'type');
    expect(typeEvents).toHaveLength(1);
    expect(typeEvents[0].value).toBe('test');
    expect(typeEvents[0].field_id).toBe('email_input');
    expect(typeEvents[0].step_id).toMatch(/^type_/);

    const tapEvents = lines.filter((e) => e.kind === 'tap');
    expect(tapEvents).toHaveLength(1);
    expect(tapEvents[0].step_id).toMatch(/^tap_/);

    expect(lines).toHaveLength(2);

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
