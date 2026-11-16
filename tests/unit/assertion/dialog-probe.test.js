'use strict';

// Why `alert_present` / `alert_text` are NOT in MECHANICAL_TYPES (#276).
//
// tests/fixtures/device/dialog-probe/ holds the engine's raw element payloads
// captured 2026-11-16 (mobile-mcp 1.0.15) with a dialog on screen:
//
//   flutter-dialog.*  the sample app's "Remove item?" AlertDialog, on an
//                     Android API 36 emulator (both engines) and an iOS 26.5
//                     simulator;
//   native-dialog.*   Android's system uninstall confirmation (a framework
//                     AlertDialog), both engines;
//   native-alert.*    an iOS system alert (the Maps location prompt).
//
// Normalized, they say "a dialog is up" on native iOS only. A Flutter dialog
// leaves just its modal barrier (a full-screen element whose label is
// Flutter's localized "Dismiss", which bottom sheets and drawers draw too),
// and a native Android dialog is identified only by framework resource-ids,
// which the element model drops by design (locked invariant: no OS element
// ids).
//
// If a re-capture on a newer engine makes one of these fail because a
// dialog-typed element appeared, that is the cue to revisit the deferral
// (#322), not a reason to loosen the assertion.

const fs = require('fs');
const path = require('path');

const { normalize } = require('../../../src/device/element-model');

const PROBE = path.join(__dirname, '..', '..', 'fixtures', 'device', 'dialog-probe');

const raw = (name) => JSON.parse(fs.readFileSync(path.join(PROBE, `${name}.raw.json`), 'utf8'));

// Any element type that would name a dialog on any toolkit.
const DIALOG_TYPE = /alert|dialog|sheet|popup|modal/i;
const dialogTyped = (elements) => elements.filter((e) => DIALOG_TYPE.test(String(e.type)));

const says = (elements, text) =>
  elements.some((e) => e.text === text || e.accessibility_label === text);

const FLUTTER = [
  ['Android, legacy engine', 'flutter-dialog.android-legacy', [0, 0, 1280, 2856]],
  ['Android, mobilecli engine', 'flutter-dialog.android-mobilecli', [0, 0, 1280, 2856]],
  ['iOS, mobilecli engine', 'flutter-dialog.ios-mobilecli', [0, 0, 402, 874]],
];

const NATIVE_ANDROID = [
  ['legacy engine', 'native-dialog.android-legacy'],
  ['mobilecli engine', 'native-dialog.android-mobilecli'],
];

describe('dialog probe: what the normalized element list carries with a dialog on screen', () => {
  test.each(FLUTTER)(
    'Flutter AlertDialog, %s: no dialog-typed element, one full-screen "Dismiss" barrier',
    (_label, name, screen) => {
      const elements = normalize(raw(name));
      expect(says(elements, 'Remove item?')).toBe(true);
      expect(dialogTyped(elements)).toEqual([]);

      const barriers = elements.filter((e) => e.accessibility_label === 'Dismiss');
      expect(barriers).toHaveLength(1);
      expect(barriers[0].bounds).toEqual(screen);
    }
  );

  test.each(NATIVE_ANDROID)(
    'native Android AlertDialog, %s: resource-ids identify it in the raw payload and normalize() drops them',
    (_label, name) => {
      const payload = raw(name);
      const ids = payload.map((e) => e.identifier);
      expect(ids).toEqual(expect.arrayContaining(['android:id/alertTitle', 'android:id/message']));

      const elements = normalize(payload);
      expect(says(elements, 'Do you want to uninstall this app?')).toBe(true);
      expect(dialogTyped(elements)).toEqual([]);
      expect(JSON.stringify(elements)).not.toContain('android:id/');
    }
  );

  test('native iOS alert: one Alert element, labelled with the title, encloses the buttons', () => {
    const elements = normalize(raw('native-alert.ios-mobilecli'));
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
