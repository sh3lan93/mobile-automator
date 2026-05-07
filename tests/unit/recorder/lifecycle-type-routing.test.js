'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { runScriptedSession } = require('../../../tools/recorder/src/lifecycle');

function readEvents(tmp, scenarioId) {
  const file = path.join(tmp, 'mobile-automator', '.recorder', scenarioId, 'events.jsonl');
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map((l) => JSON.parse(l));
}

function makeTmp() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-type-'));
  fs.mkdirSync(path.join(tmp, 'mobile-automator'));
  fs.writeFileSync(
    path.join(tmp, 'mobile-automator/config.json'),
    JSON.stringify({ mode: 'platform-aware', project_name: 'demo' })
  );
  return tmp;
}

describe('lifecycle type routing', () => {
  test('non-keyboard tap emits a tap event and no type event', async () => {
    const tmp = makeTmp();
    const script = {
      duration_ms: 2000,
      hierarchy_snapshots: [
        {
          t: 0,
          elements: [
            { type: 'android.widget.Button', bounds: [320, 1050, 760, 1130], text: 'Login' },
          ],
        },
      ],
      tap_events: [
        { kind: 'down', t: 1000, x: 540, y: 1090 },
        { kind: 'up', t: 1100, x: 540, y: 1090 },
      ],
    };
    await runScriptedSession({ projectRoot: tmp, scenarioId: 'login', script });
    const events = readEvents(tmp, 'login');
    expect(events.find((e) => e.kind === 'tap')).toBeTruthy();
    expect(events.find((e) => e.kind === 'type')).toBeFalsy();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('keyboard taps coalesce into one type event with snake_case step_id', async () => {
    const tmp = makeTmp();
    const focusedFieldEl = {
      type: 'android.widget.EditText',
      bounds: [100, 500, 980, 580],
      id: 'email_input',
      accessibility_label: 'Email',
      focused: true,
    };
    const keyboard = {
      type: 'android.inputmethodservice.SoftInputWindow',
      bounds: [0, 1500, 1080, 2400],
    };
    const keyT = { type: 'Key', bounds: [0, 1800, 100, 1900], text: 't' };
    const keyE = { type: 'Key', bounds: [100, 1800, 200, 1900], text: 'e' };
    const keyS = { type: 'Key', bounds: [200, 1800, 300, 1900], text: 's' };
    const keyT2 = { type: 'Key', bounds: [300, 1800, 400, 1900], text: 't' };

    const baseSnap = {
      elements: [focusedFieldEl, keyboard, keyT, keyE, keyS, keyT2],
    };

    const script = {
      duration_ms: 3000,
      hierarchy_snapshots: [
        { t: 0, ...baseSnap },
        { t: 1000, ...baseSnap },
        { t: 1100, ...baseSnap },
        { t: 1200, ...baseSnap },
        { t: 1300, ...baseSnap },
      ],
      tap_events: [
        { kind: 'down', t: 1000, x: 50, y: 1850 },
        { kind: 'up', t: 1050, x: 50, y: 1850 },
        { kind: 'down', t: 1100, x: 150, y: 1850 },
        { kind: 'up', t: 1150, x: 150, y: 1850 },
        { kind: 'down', t: 1200, x: 250, y: 1850 },
        { kind: 'up', t: 1250, x: 250, y: 1850 },
        { kind: 'down', t: 1300, x: 350, y: 1850 },
        { kind: 'up', t: 1350, x: 350, y: 1850 },
      ],
    };

    await runScriptedSession({ projectRoot: tmp, scenarioId: 'typing', script });
    const events = readEvents(tmp, 'typing');
    const typeEvents = events.filter((e) => e.kind === 'type');
    const tapEvents = events.filter((e) => e.kind === 'tap');
    expect(typeEvents).toHaveLength(1);
    expect(typeEvents[0].value).toBe('test');
    expect(typeEvents[0].field_id).toBe('email_input');
    expect(typeEvents[0].step_id).toBe('type_email');
    expect(tapEvents).toHaveLength(0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('Enter key flushes the type event immediately and value excludes \\n', async () => {
    const tmp = makeTmp();
    const focusedFieldEl = {
      type: 'android.widget.EditText',
      bounds: [100, 500, 980, 580],
      id: 'search_input',
      accessibility_label: 'Search',
      focused: true,
    };
    const keyboard = {
      type: 'android.inputmethodservice.SoftInputWindow',
      bounds: [0, 1500, 1080, 2400],
    };
    const keyA = { type: 'Key', bounds: [0, 1800, 100, 1900], text: 'a' };
    const keyB = { type: 'Key', bounds: [100, 1800, 200, 1900], text: 'b' };
    const keyEnter = { type: 'Key', bounds: [200, 1800, 300, 1900], text: '\n' };

    const baseSnap = { elements: [focusedFieldEl, keyboard, keyA, keyB, keyEnter] };

    const script = {
      duration_ms: 2000,
      hierarchy_snapshots: [
        { t: 0, ...baseSnap },
        { t: 1000, ...baseSnap },
        { t: 1100, ...baseSnap },
        { t: 1200, ...baseSnap },
      ],
      tap_events: [
        { kind: 'down', t: 1000, x: 50, y: 1850 },
        { kind: 'up', t: 1050, x: 50, y: 1850 },
        { kind: 'down', t: 1100, x: 150, y: 1850 },
        { kind: 'up', t: 1150, x: 150, y: 1850 },
        { kind: 'down', t: 1200, x: 250, y: 1850 },
        { kind: 'up', t: 1250, x: 250, y: 1850 },
      ],
    };

    await runScriptedSession({ projectRoot: tmp, scenarioId: 'enter', script });
    const events = readEvents(tmp, 'enter');
    const typeEvents = events.filter((e) => e.kind === 'type');
    expect(typeEvents).toHaveLength(1);
    expect(typeEvents[0].value).toBe('ab');
    expect(typeEvents[0].value).not.toContain('\n');
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
