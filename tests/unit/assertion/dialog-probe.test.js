'use strict';

// Why `alert_present` / `alert_text` are NOT in MECHANICAL_TYPES (#276).
//
// tests/fixtures/device/dialog-probe/ holds `mauto elements` envelopes
// captured 2026-11-16 (mobile-mcp 1.0.15) with a dialog on screen:
//
//   flutter-dialog.*  the sample app's "Remove item?" AlertDialog, on an
//                     Android API 36 emulator (both engines) and an iOS 26.5
//                     simulator;
//   native-dialog.*   Android's system uninstall confirmation (a framework
//                     AlertDialog), both engines;
//   native-alert.*    an iOS system alert (the Maps location prompt).
//
// plus the raw uiautomator dump of each Android dialog. They show that the
// normalized element list says "a dialog is up" on native iOS only. A Flutter
// dialog leaves just its modal barrier (a full-screen element whose label is
// Flutter's localized "Dismiss", which bottom sheets and drawers draw too), and
// a native Android dialog is identified only by framework resource-ids, which
// normalization drops by design (locked invariant: no OS element ids).
//
// These tests pin that evidence. If a re-capture on a newer engine makes one
// fail because a dialog-typed element appeared, that is the cue to revisit the
// deferral, not a reason to loosen the assertion.

const fs = require('fs');
const path = require('path');

const { evaluate, MECHANICAL_TYPES } = require('../../../src/assertion/evaluator');

const PROBE = path.join(__dirname, '..', '..', 'fixtures', 'device', 'dialog-probe');

function elementsOf(name) {
  const envelope = JSON.parse(fs.readFileSync(path.join(PROBE, name), 'utf8'));
  expect(envelope.ok).toBe(true);
  return envelope.data;
}

function rawDump(name) {
  return fs.readFileSync(path.join(PROBE, name), 'utf8');
}

// Any element type that would name a dialog on any toolkit.
const DIALOG_TYPE = /alert|dialog|sheet|popup|modal/i;
const dialogTyped = (elements) => elements.filter((e) => DIALOG_TYPE.test(String(e.type)));

const says = (elements, text) =>
  elements.some((e) => e.text === text || e.accessibility_label === text);

const NO_SIGNAL = [
  ['Flutter AlertDialog, Android, legacy engine', 'flutter-dialog.android-legacy.envelope.json', 'Remove item?'],
  ['Flutter AlertDialog, Android, mobilecli engine', 'flutter-dialog.android-mobilecli.envelope.json', 'Remove item?'],
  ['Flutter AlertDialog, iOS, mobilecli engine', 'flutter-dialog.ios-mobilecli.envelope.json', 'Remove item?'],
  ['native AlertDialog, Android, legacy engine', 'native-dialog.android-legacy.envelope.json', 'Do you want to uninstall this app?'],
  ['native AlertDialog, Android, mobilecli engine', 'native-dialog.android-mobilecli.envelope.json', 'Do you want to uninstall this app?'],
];

describe('dialog probe: what the element list carries with a dialog on screen', () => {
  test.each(NO_SIGNAL)('%s: the dialog text is listed, but no element is dialog-typed', (_label, file, text) => {
    const elements = elementsOf(file);
    expect(says(elements, text)).toBe(true);
    expect(dialogTyped(elements)).toEqual([]);
  });

  test.each([
    ['Android, legacy engine', 'flutter-dialog.android-legacy.envelope.json', [0, 0, 1280, 2856]],
    ['Android, mobilecli engine', 'flutter-dialog.android-mobilecli.envelope.json', [0, 0, 1280, 2856]],
    ['iOS, mobilecli engine', 'flutter-dialog.ios-mobilecli.envelope.json', [0, 0, 402, 874]],
  ])('Flutter AlertDialog, %s: the only trace is the full-screen "Dismiss" barrier', (_label, file, screen) => {
    const barriers = elementsOf(file).filter((e) => e.accessibility_label === 'Dismiss');
    expect(barriers).toHaveLength(1);
    expect(barriers[0].bounds).toEqual(screen);
  });

  test('native Android AlertDialog: only resource-ids identify it, and normalization drops them', () => {
    const raw = rawDump('native-dialog.android.uiautomator.xml');
    expect(raw).toContain('resource-id="android:id/alertTitle"');
    expect(raw).toContain('resource-id="android:id/message"');

    for (const file of ['native-dialog.android-legacy.envelope.json', 'native-dialog.android-mobilecli.envelope.json']) {
      expect(JSON.stringify(elementsOf(file))).not.toMatch(/alertTitle|android:id/);
    }
  });

  test('Flutter AlertDialog on Android: the raw dump has no dialog class or pane title either', () => {
    const raw = rawDump('flutter-dialog.android.uiautomator.xml');
    expect(raw).toContain('content-desc="Remove item?"');
    expect(raw).not.toMatch(/alertTitle|AlertDialog|pane-title/);
  });

  test('native iOS alert: one Alert element, labelled with the title, encloses the buttons', () => {
    const elements = elementsOf('native-alert.ios-mobilecli.envelope.json');
    const alerts = dialogTyped(elements);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe('Alert');
    expect(alerts[0].accessibility_label).toBe('Allow “Maps” to use your location?');

    const [ax1, ay1, ax2, ay2] = alerts[0].bounds;
    const buttons = elements.filter((e) => e.type === 'Button');
    expect(buttons.map((b) => b.accessibility_label)).toEqual(['Allow Once', 'Allow While Using App', 'Don’t Allow']);
    for (const { bounds: [x1, y1, x2, y2] } of buttons) {
      expect(x1 >= ax1 && y1 >= ay1 && x2 <= ax2 && y2 <= ay2).toBe(true);
    }
  });
});

describe('alert_present / alert_text stay agent-judged', () => {
  const FILES = [...NO_SIGNAL.map(([, file]) => file), 'native-alert.ios-mobilecli.envelope.json'];

  test.each(['alert_present', 'alert_text'])('%s is not a mechanical type', (type) => {
    expect(MECHANICAL_TYPES.has(type)).toBe(false);
  });

  test.each(FILES)('evaluate() answers needs_agent over %s', (file) => {
    const elements = elementsOf(file);
    for (const assertion of [{ type: 'alert_present' }, { type: 'alert_text', expected: 'Remove item?' }]) {
      const r = evaluate(assertion, { elements });
      expect(r.mechanical).toBe(false);
      expect(r.needs_agent).toBe(true);
      expect(r.pass).toBeNull();
    }
  });
});
