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

// One parser owns the raw device list: deviceRecords keeps `type` (which the
// crash guard needs), and normalizeDevices is only its 4-key public view.
describe('deviceRecords', () => {
  const { deviceRecords } = require('../../../src/device/device-model');

  test('keeps type alongside the public keys, from either list shape', () => {
    const raw = [{ id: 'sim-1', name: 'iPhone 15', os: 'ios', type: 'simulator', state: 'online' }];
    const expected = [{ id: 'sim-1', name: 'iPhone 15', platform: 'ios', state: 'online', type: 'simulator' }];
    expect(deviceRecords(raw)).toEqual(expected);
    expect(deviceRecords({ devices: raw })).toEqual(expected);
  });

  test('type is nullable like the other fields; garbage input -> []', () => {
    expect(deviceRecords([{ id: 'a' }])).toEqual([
      { id: 'a', name: null, platform: null, state: null, type: null },
    ]);
    expect(deviceRecords(null)).toEqual([]);
    expect(deviceRecords({ devices: 'x' })).toEqual([]);
  });

  test('the public view still drops type: exactly the four locked keys', () => {
    const out = normalizeDevices([{ id: 'sim-1', name: 'n', os: 'ios', type: 'simulator', state: 's' }]);
    expect(Object.keys(out[0])).toEqual(['id', 'name', 'platform', 'state']);
  });
});

describe('isIosSimulator', () => {
  const { isIosSimulator } = require('../../../src/device/device-model');

  test.each([
    [{ platform: 'ios', type: 'simulator' }, true],
    [{ platform: 'iOS', type: 'Simulator' }, true],
    [{ platform: 'ios', type: 'real' }, false],
    [{ platform: 'ios', type: null }, false],
    [{ platform: 'android', type: 'simulator' }, false],
    [{ platform: 'android', type: 'emulator' }, false],
    [{ platform: null, type: 'simulator' }, false],
  ])('%j -> %s', (record, expected) => {
    expect(isIosSimulator(record)).toBe(expected);
  });
});
