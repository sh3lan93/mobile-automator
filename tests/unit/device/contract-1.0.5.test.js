'use strict';

// Recorded-fixture contract for the pinned device engine, mobile-mcp 1.0.5.
//
// Every file under tests/fixtures/device/mobile-mcp-1.0.5/ is a REAL capture,
// not a hand-written shape. They were recorded on 2026-09-30 during the device
// run for #199 (task T8), by an MCP client calling the pinned engine
// (@mobilenext/mobile-mcp 1.0.5, driving mobilecli 1.0.13) with
// format:"json" on the element tool — exactly the text our bridge receives:
//
//   android-default.*  Pixel 9 Pro emulator (API 36), default mobilecli robot,
//                      Android Settings root screen. Device id `Pixel_9_Pro`.
//   android-legacy.*   the same emulator and screen under
//                      MOBILEMCP_LEGACY_ROBOT=1 (uiautomator). Device id
//                      `emulator-5554`. No crashes capture: the crash tool
//                      fails in legacy mode (known, documented).
//   ios-sim.*          iPhone 15 simulator (iOS 17.0), Settings root screen.
//
// Why recorded fixtures exist: the contract test in tests/integration checks
// the engine's tool SCHEMAS (names and arguments). It cannot see the OUTPUT
// shapes our parsers consume — element JSON, device lists, the screen-size
// string, crash reports — and those are what silently broke on the 1.0.5
// upgrade. These tests pin the output shapes against real data.
//
// Re-capture every file here when bumping the @mobilenext/mobile-mcp pin.

const fs = require('fs');
const path = require('path');
const { parseToolResult } = require('../../../src/device/mobile-mcp-client');
const { parseElements, normalize } = require('../../../src/device/element-model');
const { normalizeDevices } = require('../../../src/device/device-model');
const { normalizeCrashes, crashTimestampMs } = require('../../../src/device/crash-model');
const { DeviceBridge } = require('../../../src/device/bridge');
const { injectDeviceArg } = require('../../../src/device/tool-args');

const FX = path.join(__dirname, '../../fixtures/device/mobile-mcp-1.0.5');

function readRaw(source, kind) {
  return fs.readFileSync(path.join(FX, `${source}.${kind}.txt`), 'utf8');
}

// What makeCall hands the bridge: the engine's text content block run through
// parseToolResult (JSON text is parsed; anything else passes through as text).
function captured(source, kind) {
  return parseToolResult({ content: [{ type: 'text', text: readRaw(source, kind) }] });
}

const IOS_UDID = 'C6C6FFB9-7382-456B-9EE8-0047C8EEA80B';

const ELEMENT_SOURCES = [
  // [source, raw element count, labels a real user sees on that screen]
  ['android-default', 96, ['Network & internet', 'Search Settings']],
  ['android-legacy', 62, ['Network & internet', 'Search Settings']],
  ['ios-sim', 58, ['General', 'Settings']],
];

describe('mobile-mcp 1.0.5 contract (recorded real-device fixtures)', () => {
  describe.each(ELEMENT_SOURCES)('elements: %s', (source, rawCount, knownLabels) => {
    const raw = captured(source, 'elements');
    const rawElements = parseElements(raw);
    const els = normalize(rawElements);
    const json = JSON.stringify(els);
    const visible = new Set(
      els.flatMap((e) => [e.text, e.accessibility_label]).filter((v) => v != null),
    );

    test('parses and normalizes every captured element', () => {
      expect(() => parseElements(raw)).not.toThrow();
      expect(rawElements).toHaveLength(rawCount);
      expect(els).toHaveLength(rawCount);
    });

    test('every element has four finite bounds and a center inside them', () => {
      els.forEach((e) => {
        expect(e.bounds).toHaveLength(4);
        e.bounds.forEach((n) => expect(Number.isFinite(n)).toBe(true));
        const [x1, y1, x2, y2] = e.bounds;
        const [cx, cy] = e.center;
        expect(cx).toBeGreaterThanOrEqual(x1);
        expect(cx).toBeLessThanOrEqual(x2);
        expect(cy).toBeGreaterThanOrEqual(y1);
        expect(cy).toBeLessThanOrEqual(y2);
      });
    });

    test('known on-screen labels surface as text or accessibility_label', () => {
      knownLabels.forEach((label) => expect(visible.has(label)).toBe(true));
    });

    test('no identifier, ref or name key reaches a normalized element', () => {
      els.forEach((e) => {
        expect(e).not.toHaveProperty('identifier');
        expect(e).not.toHaveProperty('ref');
        expect(e).not.toHaveProperty('name');
      });
    });

    test('no raw identifier leaks unless it is also visible text on screen', () => {
      // Some iOS identifiers equal the row's visible label ("VPN"); those are
      // legitimately present. Every other identifier must be absent. What is
      // "visible" comes from the RAW text/label, never the normalized output —
      // otherwise a leaked identifier would exempt itself.
      const rawVisible = new Set(
        rawElements.flatMap((r) => [r.text, r.label]).filter((v) => v != null && v !== ''),
      );
      const hidden = rawElements
        .map((r) => r.identifier)
        .filter((id) => typeof id === 'string' && id !== '' && !rawVisible.has(id));
      expect(hidden.length).toBeGreaterThan(0);
      hidden.forEach((id) => expect(json).not.toContain(JSON.stringify(id)));
    });
  });

  test('the known Android resource-ids never reach the normalized output', () => {
    const def = JSON.stringify(normalize(parseElements(captured('android-default', 'elements'))));
    const legacy = JSON.stringify(normalize(parseElements(captured('android-legacy', 'elements'))));
    expect(readRaw('android-legacy', 'elements')).toContain('com.android.settings:id/search_bar_title');
    expect(readRaw('android-default', 'elements')).toContain('com.android.systemui:id/status_bar');
    expect(legacy).not.toContain('com.android.settings:id/search_bar_title');
    expect(def).not.toContain('com.android.systemui:id/status_bar');
    expect(def).not.toContain(':id/');
    expect(legacy).not.toContain(':id/');
  });

  test('the iOS APPLE_ACCOUNT identifier never reaches the normalized output', () => {
    expect(readRaw('ios-sim', 'elements')).toContain('APPLE_ACCOUNT');
    const els = normalize(parseElements(captured('ios-sim', 'elements')));
    expect(JSON.stringify(els)).not.toContain('APPLE_ACCOUNT');
  });

  test('iOS name-only elements do not gain a label from `name`', () => {
    // On iOS `name` is frequently the accessibility identifier, so it must
    // never be promoted to accessibility_label.
    const rawElements = parseElements(captured('ios-sim', 'elements'));
    const els = normalize(rawElements);
    const nameOnly = rawElements
      .map((r, i) => [r, i])
      .filter(([r]) => r.name && !r.text && !r.label);
    expect(nameOnly.map(([r]) => r.name)).toEqual(
      expect.arrayContaining(['APPLE_ACCOUNT', 'Settings']),
    );
    // Every raw element normalizes (count parity above), so indices align.
    nameOnly.forEach(([r, i]) => {
      expect(els[i].bounds[0]).toBe(r.coordinates.x);
      expect(els[i].text).toBeNull();
      expect(els[i].accessibility_label).toBeNull();
    });
  });

  describe('devices', () => {
    // Pins the B2 fact: the default engine names an emulator by its AVD name,
    // the legacy robot by its adb serial.
    test.each([
      ['android-default', 'Pixel_9_Pro'],
      ['ios-sim', 'Pixel_9_Pro'],
      ['android-legacy', 'emulator-5554'],
    ])('%s lists the Android emulator as %s and the simulator by UDID', (source, androidId) => {
      const devices = normalizeDevices(captured(source, 'devices'));
      expect(devices).toEqual([
        { id: androidId, name: 'Pixel 9 Pro', platform: 'android', state: 'online' },
        { id: IOS_UDID, name: 'iPhone 15', platform: 'ios', state: 'online' },
      ]);
    });
  });

  describe('screen size', () => {
    test.each([
      ['android-default', { width: 1280, height: 2856 }],
      ['android-legacy', { width: 1280, height: 2856 }],
      // iOS reports points, labelled "pixels".
      ['ios-sim', { width: 393, height: 852 }],
    ])('%s parses through DeviceBridge#getScreenSize', async (source, expected) => {
      const call = async (tool) => {
        if (tool === 'mobile_get_screen_size') return captured(source, 'screen');
        throw new Error(`unexpected tool ${tool}`);
      };
      const bridge = new DeviceBridge({ call });
      expect(await bridge.getScreenSize()).toEqual(expected);
    });
  });

  describe.each(['android-default', 'ios-sim'])('crashes: %s', (source) => {
    test('normalizes to id/process/timestamp with a readable, positive time', () => {
      const crashes = normalizeCrashes(captured(source, 'crashes'));
      expect(crashes.length).toBeGreaterThan(0);
      crashes.forEach((c) => {
        expect(typeof c.id).toBe('string');
        expect(typeof c.process).toBe('string');
        expect(typeof c.timestamp).toBe('string');
        const ms = crashTimestampMs(c);
        expect(Number.isFinite(ms)).toBe(true);
        expect(ms).toBeGreaterThan(0);
      });
    });
  });

  test('device is injected for action tools, not for discovery', () => {
    const android = normalizeDevices(captured('android-default', 'devices'))
      .find((d) => d.platform === 'android');
    expect(injectDeviceArg('mobile_click_on_screen_at_coordinates', { x: 1, y: 2 }, android.id))
      .toEqual({ x: 1, y: 2, device: 'Pixel_9_Pro' });
    expect(injectDeviceArg('mobile_list_available_devices', {}, android.id)).toEqual({});
  });
});
