'use strict';
const { makeCall } = require('../../../src/device/mobile-mcp-client');
const { DeviceResolutionError } = require('../../../src/device/device-resolver');

function rawWith(devices) {
  const calls = [];
  const rawCall = jest.fn(async (tool, args) => {
    calls.push({ tool, args });
    if (tool === 'mobile_list_available_devices') return devices;  // parsed already
    return `ok:${tool}`;
  });
  return { rawCall, calls };
}

describe('makeCall device threading', () => {
  test('injects an explicit device into action tool calls', async () => {
    const { rawCall, calls } = rawWith([]);
    const { call } = makeCall({ rawCall, device: 'emulator-5554' });
    await call('mobile_click_on_screen_at_coordinates', { x: 1, y: 2 });
    expect(calls[0]).toEqual({ tool: 'mobile_click_on_screen_at_coordinates', args: { x: 1, y: 2, device: 'emulator-5554' } });
  });

  test('auto-discovers the single device when none was pinned, and caches it', async () => {
    const { rawCall, calls } = rawWith([{ id: 'emulator-5554', name: 'Pixel' }]);
    const { call } = makeCall({ rawCall, device: null });
    await call('mobile_type_keys', { text: 'a' });
    await call('mobile_swipe_on_screen', { direction: 'up' });
    // one discovery call + two action calls, all actions carry the resolved device
    const discovery = calls.filter((c) => c.tool === 'mobile_list_available_devices');
    expect(discovery).toHaveLength(1);
    expect(calls.find((c) => c.tool === 'mobile_type_keys').args.device).toBe('emulator-5554');
    expect(calls.find((c) => c.tool === 'mobile_swipe_on_screen').args.device).toBe('emulator-5554');
  });

  test('mobile_list_available_devices itself never carries a device arg', async () => {
    const { rawCall, calls } = rawWith([{ id: 'd1' }]);
    const { call } = makeCall({ rawCall, device: null });
    await call('mobile_list_available_devices', {});
    expect(calls[0].args).toEqual({});
  });

  test('throws DeviceResolutionError when discovery finds no device', async () => {
    const { rawCall } = rawWith([]);
    const { call } = makeCall({ rawCall, device: null });
    await expect(call('mobile_save_screenshot', { path: '/tmp/x.png' })).rejects.toBeInstanceOf(DeviceResolutionError);
  });
});
