'use strict';

const { DeviceBridge } = require('../../../src/device/bridge');

describe('DeviceBridge', () => {
  test('throws TypeError when call is not a function', () => {
    expect(() => new DeviceBridge({})).toThrow(TypeError);
    expect(() => new DeviceBridge({ call: 'nope' })).toThrow(TypeError);
  });

  describe('listElements', () => {
    test('invokes mobile_list_elements_on_screen and returns normalized agnostic elements', async () => {
      const calls = [];
      const call = async (tool, args) => {
        calls.push([tool, args]);
        return {
          elements: [
            {
              text: 'Login',
              bounds: [0, 0, 100, 50],
              resource_id: 'com.app:id/login',
              type: 'Button',
            },
          ],
        };
      };
      const bridge = new DeviceBridge({ call });
      const els = await bridge.listElements();

      expect(calls).toEqual([['mobile_list_elements_on_screen', {}]]);
      expect(els).toHaveLength(1);
      expect(els[0]).toEqual({
        text: 'Login',
        accessibility_label: null,
        bounds: [0, 0, 100, 50],
        center: [50, 25],
        type: 'Button',
      });
      expect(Object.keys(els[0])).not.toContain('resource_id');
    });

    test('tolerates the result being a bare array', async () => {
      const call = async () => [{ text: 'A', bounds: [0, 0, 2, 2] }];
      const bridge = new DeviceBridge({ call });
      const els = await bridge.listElements();
      expect(els).toHaveLength(1);
      expect(els[0].center).toEqual([1, 1]);
    });
  });

  describe('screenshot', () => {
    test('invokes mobile_save_screenshot with the dest path and returns result.path', async () => {
      const calls = [];
      const call = async (tool, args) => {
        calls.push([tool, args]);
        return { path: '/tmp/actual.png' };
      };
      const bridge = new DeviceBridge({ call });
      const p = await bridge.screenshot('/tmp/req.png');
      expect(calls).toEqual([['mobile_save_screenshot', { path: '/tmp/req.png' }]]);
      expect(p).toBe('/tmp/actual.png');
    });

    test('falls back to the requested path when result has none', async () => {
      const call = async () => ({});
      const bridge = new DeviceBridge({ call });
      const p = await bridge.screenshot('/tmp/req.png');
      expect(p).toBe('/tmp/req.png');
    });
  });
});
