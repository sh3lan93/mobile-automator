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

  test('scripted iOS session produces a literal tap step on the nav-bar back button', async () => {
    // Locks in the aware-mode iOS acceptance criterion: a tap on the
    // navigation-bar back chevron is captured as a regular tap step with the
    // `accessibility_label` as its display name — no special-case
    // press_back semantic emission. Also exercises the iOS XCUIElementType*
    // hierarchy shapes through the resolver end-to-end.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-int-'));
    fs.mkdirSync(path.join(tmp, 'mobile-automator'));
    fs.writeFileSync(path.join(tmp, 'mobile-automator/config.json'), JSON.stringify({ mode: 'platform-aware', project_name: 'demo' }));

    const script = JSON.parse(fs.readFileSync(path.join(__dirname, '../../fixtures/recorder/scripted-session-ios.json'), 'utf8'));
    await runScriptedSession({ projectRoot: tmp, scenarioId: 's', script });

    const events = fs.readFileSync(path.join(tmp, 'mobile-automator/.recorder/s/events.jsonl'), 'utf8');
    const lines = events.trim().split('\n').map((l) => JSON.parse(l));

    const tapEvents = lines.filter((e) => e.kind === 'tap');
    expect(tapEvents).toHaveLength(1);
    expect(tapEvents[0].target).toBe('Back');
    expect(tapEvents[0].step_id).toBe('tap_back');

    // Locks in: no press_back semantic event was synthesised; the recorder
    // captured only the raw tap.
    expect(lines.find((e) => e.kind === 'press_back')).toBeUndefined();

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('merges hardware-key events into events.jsonl ordered by timestamp', async () => {
    // Locks in slice #26's acceptance contract: a key UP event arriving
    // between two video-detected taps shows up in events.jsonl in t-order
    // (tap@200, press_button BACK@380, tap@500). Aware mode emits one
    // press_button step per key release — DOWN frames are absorbed.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-int-'));
    fs.mkdirSync(path.join(tmp, 'mobile-automator'));
    fs.writeFileSync(path.join(tmp, 'mobile-automator/config.json'), JSON.stringify({ mode: 'platform-aware', project_name: 'demo' }));

    const script = JSON.parse(fs.readFileSync(path.join(__dirname, '../../fixtures/recorder/scripted-session-keys.json'), 'utf8'));
    await runScriptedSession({ projectRoot: tmp, scenarioId: 's', script });

    const events = fs.readFileSync(path.join(tmp, 'mobile-automator/.recorder/s/events.jsonl'), 'utf8');
    const lines = events.trim().split('\n').map((l) => JSON.parse(l));

    // Three steps emerge: two taps and one press_button (BACK release only).
    expect(lines).toHaveLength(3);

    expect(lines[0]).toMatchObject({ kind: 'tap', target: 'Login' });
    expect(lines[0].t).toBeLessThanOrEqual(250);

    expect(lines[1]).toMatchObject({ kind: 'press_button', value: 'BACK', step_id: 'press_button_back', t: 380 });

    expect(lines[2]).toMatchObject({ kind: 'tap', target: 'Sign Up' });
    expect(lines[2].t).toBeGreaterThanOrEqual(500);

    // Locks in the t-order invariant explicitly, not just by index.
    const ts = lines.map((e) => e.t);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('coalesces keyboard taps with a real-world Gboard hierarchy class name', async () => {
    // Locks in the case-insensitive keyboard-region regex against actual
    // production class names (Gboard's `com.google.android.inputmethod.latin.LatinIME`)
    // rather than the synthetic `SoftInputWindow` used in the original fixture.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-int-'));
    fs.mkdirSync(path.join(tmp, 'mobile-automator'));
    fs.writeFileSync(path.join(tmp, 'mobile-automator/config.json'), JSON.stringify({ mode: 'platform-aware', project_name: 'demo' }));

    const script = JSON.parse(fs.readFileSync(path.join(__dirname, '../../fixtures/recorder/scripted-session-gboard.json'), 'utf8'));
    await runScriptedSession({ projectRoot: tmp, scenarioId: 's', script });

    const events = fs.readFileSync(path.join(tmp, 'mobile-automator/.recorder/s/events.jsonl'), 'utf8');
    const lines = events.trim().split('\n').map((l) => JSON.parse(l));

    const typeEvents = lines.filter((e) => e.kind === 'type');
    expect(typeEvents).toHaveLength(1);
    expect(typeEvents[0].value).toBe('test');
    expect(typeEvents[0].field_id).toBe('email_input');

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
