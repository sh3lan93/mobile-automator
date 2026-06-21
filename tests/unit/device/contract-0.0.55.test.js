'use strict';
const fs = require('fs');
const path = require('path');
const { parseElements, normalize } = require('../../../src/device/element-model');
const { injectDeviceArg } = require('../../../src/device/tool-args');
const { resolveSingleDevice } = require('../../../src/device/device-resolver');
const { normalizeDevices } = require('../../../src/device/device-model');

const FX = path.join(__dirname, '../../fixtures/device');
const elementsRaw = fs.readFileSync(path.join(FX, 'mcp-list-elements-0.0.55.txt'), 'utf8');
const devicesRaw = JSON.parse(fs.readFileSync(path.join(FX, 'mcp-list-devices-0.0.55.json'), 'utf8'));

describe('mobile-mcp 0.0.55 contract (recorded fixtures)', () => {
  test('the prefixed element string normalizes to positioned, label-bearing elements', () => {
    const els = normalize(parseElements(elementsRaw));
    expect(els.length).toBeGreaterThanOrEqual(4);
    const labels = els.map((e) => e.accessibility_label);
    expect(labels).toContain('Sample Shop');
    expect(labels).toContain('Wireless Earbuds');
    els.forEach((e) => { expect(e.bounds).toHaveLength(4); });
  });
  test('no resource-id/identifier leaks into the normalized output', () => {
    const els = normalize(parseElements(elementsRaw));
    expect(JSON.stringify(els)).not.toContain('home_product_card_p001');
    expect(JSON.stringify(els)).not.toContain('bottom_nav_home');
  });
  test('device is injected for action tools, not for discovery', () => {
    const id = resolveSingleDevice(normalizeDevices(devicesRaw));
    expect(injectDeviceArg('mobile_click_on_screen_at_coordinates', { x: 1, y: 2 }, id))
      .toEqual({ x: 1, y: 2, device: 'emulator-5554' });
    expect(injectDeviceArg('mobile_list_available_devices', {}, id)).toEqual({});
  });
});
