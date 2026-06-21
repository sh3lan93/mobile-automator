'use strict';
const { injectDeviceArg } = require('../../../src/device/tool-args');

describe('injectDeviceArg', () => {
  test('injects device into a normal tool call', () => {
    expect(injectDeviceArg('mobile_click_on_screen_at_coordinates', { x: 1, y: 2 }, 'emulator-5554'))
      .toEqual({ x: 1, y: 2, device: 'emulator-5554' });
  });
  test('does NOT inject device into mobile_list_available_devices', () => {
    expect(injectDeviceArg('mobile_list_available_devices', {}, 'emulator-5554')).toEqual({});
  });
  test('leaves args unchanged when deviceId is falsy', () => {
    expect(injectDeviceArg('mobile_type_keys', { text: 'hi' }, null)).toEqual({ text: 'hi' });
  });
  test('does not mutate the input args', () => {
    const args = { x: 1 };
    injectDeviceArg('mobile_swipe_on_screen', args, 'd');
    expect(args).toEqual({ x: 1 });
  });
});
