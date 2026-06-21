'use strict';
const { resolveSingleDevice, DeviceResolutionError } = require('../../../src/device/device-resolver');

describe('resolveSingleDevice', () => {
  test('returns the id when exactly one device is active', () => {
    expect(resolveSingleDevice([{ id: 'emulator-5554', name: 'Pixel', platform: 'android', state: 'booted' }]))
      .toBe('emulator-5554');
  });
  test('throws an actionable error when no device is active', () => {
    expect(() => resolveSingleDevice([])).toThrow(DeviceResolutionError);
    try { resolveSingleDevice([]); } catch (e) {
      expect(e.kind).toBe('device');
      expect(e.message).toMatch(/no active device/i);
      expect(e.hint).toMatch(/--device/);
    }
  });
  test('throws an actionable error listing ids when multiple are active', () => {
    const devices = [{ id: 'emulator-5554', name: 'Pixel' }, { id: 'AAAA-BBBB', name: 'iPhone 16' }];
    expect(() => resolveSingleDevice(devices)).toThrow(DeviceResolutionError);
    try { resolveSingleDevice(devices); throw new Error('expected resolveSingleDevice to throw'); } catch (e) {
      expect(e).toBeInstanceOf(DeviceResolutionError);
      expect(e.message).toContain('emulator-5554');
      expect(e.message).toContain('AAAA-BBBB');
      expect(e.hint).toMatch(/mauto devices use|--device/);
    }
  });
});
