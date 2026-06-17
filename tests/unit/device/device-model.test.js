'use strict';

const { normalizeDevices } = require('../../../src/device/device-model');

describe('normalizeDevices', () => {
  test('normalizes id/name/platform/state and maps os -> platform', () => {
    const out = normalizeDevices([
      { id: 'emulator-5554', name: 'Pixel 7', os: 'android', state: 'running' },
    ]);
    expect(out).toEqual([
      { id: 'emulator-5554', name: 'Pixel 7', platform: 'android', state: 'running' },
    ]);
  });

  test('prefers an explicit platform field over os', () => {
    const out = normalizeDevices([{ id: 'x', platform: 'ios', os: 'android' }]);
    expect(out[0].platform).toBe('ios');
  });

  test('tolerates a bare array', () => {
    const out = normalizeDevices([{ id: 'a' }, { id: 'b' }]);
    expect(out.map((d) => d.id)).toEqual(['a', 'b']);
  });

  test('tolerates the { devices: [...] } wrapper', () => {
    const out = normalizeDevices({ devices: [{ id: 'a', name: 'A' }] });
    expect(out).toEqual([{ id: 'a', name: 'A', platform: null, state: null }]);
  });

  test('empty / garbage input -> []', () => {
    expect(normalizeDevices(null)).toEqual([]);
    expect(normalizeDevices(undefined)).toEqual([]);
    expect(normalizeDevices(42)).toEqual([]);
    expect(normalizeDevices('nope')).toEqual([]);
    expect(normalizeDevices({})).toEqual([]);
    expect(normalizeDevices({ devices: 'x' })).toEqual([]);
  });

  test('skips entries that have no identifiable id', () => {
    const out = normalizeDevices([{ name: 'no id' }, null, 7, { id: 'keep' }]);
    expect(out).toEqual([{ id: 'keep', name: null, platform: null, state: null }]);
  });

  test('falls back across alternate id keys (udid/deviceId/serial)', () => {
    expect(normalizeDevices([{ udid: 'U1' }])[0].id).toBe('U1');
    expect(normalizeDevices([{ deviceId: 'D1' }])[0].id).toBe('D1');
    expect(normalizeDevices([{ serial: 'S1' }])[0].id).toBe('S1');
  });

  test('output contains ONLY the four agnostic keys (no leaked raw fields)', () => {
    const out = normalizeDevices([
      {
        id: 'emulator-5554',
        name: 'Pixel',
        os: 'android',
        state: 'running',
        resource_id: 'leak',
        udid: 'also-leak',
        extra: { nested: true },
      },
    ]);
    expect(Object.keys(out[0]).sort()).toEqual(['id', 'name', 'platform', 'state']);
    expect(JSON.stringify(out)).not.toMatch(/resource_id/);
    expect(JSON.stringify(out)).not.toMatch(/leak/);
  });
});
