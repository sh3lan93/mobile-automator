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

  describe('listDevices', () => {
    test('invokes mobile_list_available_devices with {} and returns normalized devices', async () => {
      const calls = [];
      const call = async (tool, args) => {
        calls.push([tool, args]);
        return {
          devices: [
            { id: 'emulator-5554', name: 'Pixel', os: 'android', state: 'running', resource_id: 'leak' },
          ],
        };
      };
      const bridge = new DeviceBridge({ call });
      const devices = await bridge.listDevices();

      expect(calls).toEqual([['mobile_list_available_devices', {}]]);
      expect(devices).toEqual([
        { id: 'emulator-5554', name: 'Pixel', platform: 'android', state: 'running' },
      ]);
      expect(JSON.stringify(devices)).not.toMatch(/resource_id/);
    });

    test('tolerates the result being a bare array', async () => {
      const call = async () => [{ id: 'a' }, { id: 'b' }];
      const bridge = new DeviceBridge({ call });
      const devices = await bridge.listDevices();
      expect(devices.map((d) => d.id)).toEqual(['a', 'b']);
    });
  });

  describe('screenshot', () => {
    test('invokes mobile_save_screenshot with the dest path under the saveTo key', async () => {
      const calls = [];
      const call = async (tool, args) => {
        calls.push([tool, args]);
        return { path: '/tmp/actual.png' };
      };
      const bridge = new DeviceBridge({ call });
      const p = await bridge.screenshot('/tmp/req.png');
      expect(calls).toEqual([['mobile_save_screenshot', { saveTo: '/tmp/req.png' }]]);
      expect(p).toBe('/tmp/actual.png');
    });

    test('falls back to the requested path when result has none', async () => {
      const call = async () => ({});
      const bridge = new DeviceBridge({ call });
      const p = await bridge.screenshot('/tmp/req.png');
      expect(p).toBe('/tmp/req.png');
    });
  });

  describe('tap', () => {
    test('invokes mobile_click_on_screen_at_coordinates with x,y', async () => {
      const calls = [];
      const call = async (tool, args) => { calls.push([tool, args]); return {}; };
      const bridge = new DeviceBridge({ call });
      await bridge.tap({ x: 12, y: 34 });
      expect(calls).toEqual([['mobile_click_on_screen_at_coordinates', { x: 12, y: 34 }]]);
    });
  });

  describe('longPress', () => {
    test('invokes mobile_long_press_on_screen_at_coordinates with x,y and omits duration when absent', async () => {
      const calls = [];
      const call = async (tool, args) => { calls.push([tool, args]); return {}; };
      const bridge = new DeviceBridge({ call });
      await bridge.longPress({ x: 12, y: 34 });
      expect(calls).toEqual([['mobile_long_press_on_screen_at_coordinates', { x: 12, y: 34 }]]);
    });

    test('forwards duration when provided', async () => {
      const calls = [];
      const call = async (tool, args) => { calls.push([tool, args]); return {}; };
      const bridge = new DeviceBridge({ call });
      await bridge.longPress({ x: 12, y: 34, duration: 1200 });
      expect(calls).toEqual([['mobile_long_press_on_screen_at_coordinates', { x: 12, y: 34, duration: 1200 }]]);
    });
  });

  describe('doubleTap', () => {
    test('invokes mobile_double_tap_on_screen with x,y', async () => {
      const calls = [];
      const call = async (tool, args) => { calls.push([tool, args]); return {}; };
      const bridge = new DeviceBridge({ call });
      await bridge.doubleTap({ x: 12, y: 34 });
      expect(calls).toEqual([['mobile_double_tap_on_screen', { x: 12, y: 34 }]]);
    });
  });

  describe('type', () => {
    test('invokes mobile_type_keys with text and submit=false', async () => {
      const calls = [];
      const call = async (tool, args) => { calls.push([tool, args]); return {}; };
      const bridge = new DeviceBridge({ call });
      await bridge.type('hello');
      expect(calls).toEqual([['mobile_type_keys', { text: 'hello', submit: false }]]);
    });
  });

  describe('swipe', () => {
    test('invokes mobile_swipe_on_screen with the direction', async () => {
      const calls = [];
      const call = async (tool, args) => { calls.push([tool, args]); return {}; };
      const bridge = new DeviceBridge({ call });
      await bridge.swipe({ direction: 'up' });
      expect(calls).toEqual([['mobile_swipe_on_screen', { direction: 'up' }]]);
    });
  });

  describe('pressButton', () => {
    test('invokes mobile_press_button with the button name', async () => {
      const calls = [];
      const call = async (tool, args) => { calls.push([tool, args]); return {}; };
      const bridge = new DeviceBridge({ call });
      await bridge.pressButton('BACK');
      expect(calls).toEqual([['mobile_press_button', { button: 'BACK' }]]);
    });
  });

  describe('launchApp', () => {
    test('invokes mobile_launch_app with the packageName', async () => {
      const calls = [];
      const call = async (tool, args) => { calls.push([tool, args]); return {}; };
      const bridge = new DeviceBridge({ call });
      await bridge.launchApp('com.example.app');
      expect(calls).toEqual([['mobile_launch_app', { packageName: 'com.example.app' }]]);
    });
  });

  describe('installApp', () => {
    test('invokes mobile_install_app with the artifact path', async () => {
      const calls = [];
      const call = async (tool, args) => { calls.push([tool, args]); return {}; };
      const bridge = new DeviceBridge({ call });
      await bridge.installApp('/tmp/app.apk');
      expect(calls).toEqual([['mobile_install_app', { path: '/tmp/app.apk' }]]);
    });
  });

  describe('uninstallApp', () => {
    test('invokes mobile_uninstall_app with the bundle_id', async () => {
      const calls = [];
      const call = async (tool, args) => { calls.push([tool, args]); return {}; };
      const bridge = new DeviceBridge({ call });
      await bridge.uninstallApp('com.example.app');
      expect(calls).toEqual([['mobile_uninstall_app', { bundle_id: 'com.example.app' }]]);
    });
  });

  describe('openUrl', () => {
    test('invokes mobile_open_url with the url', async () => {
      const calls = [];
      const call = async (tool, args) => { calls.push([tool, args]); return {}; };
      const bridge = new DeviceBridge({ call });
      await bridge.openUrl('https://example.com');
      expect(calls).toEqual([['mobile_open_url', { url: 'https://example.com' }]]);
    });
  });

  describe('setOrientation', () => {
    test('invokes mobile_set_orientation with the orientation', async () => {
      const calls = [];
      const call = async (tool, args) => { calls.push([tool, args]); return {}; };
      const bridge = new DeviceBridge({ call });
      await bridge.setOrientation('landscape');
      expect(calls).toEqual([['mobile_set_orientation', { orientation: 'landscape' }]]);
    });
  });
});

describe('getPlatform', () => {
  test('returns the lowercased platform of the single connected device', async () => {
    const call = async (tool) => {
      if (tool === 'mobile_list_available_devices') {
        return [{ id: 'emu-5554', name: 'Pixel', os: 'android', state: 'booted' }];
      }
      return {};
    };
    const bridge = new DeviceBridge({ call });
    expect(await bridge.getPlatform()).toBe('android');
  });

  test('matches the pinned device id when several are connected', async () => {
    const call = async (tool) => {
      if (tool === 'mobile_list_available_devices') {
        return [
          { id: 'emu-5554', os: 'android' },
          { id: 'sim-iphone', os: 'ios' },
        ];
      }
      return {};
    };
    const bridge = new DeviceBridge({ call, device: 'sim-iphone' });
    expect(await bridge.getPlatform()).toBe('ios');
  });
});

describe('getScreenSize', () => {
  test('parses mobile-mcp\'s real "Screen size is WxH pixels" string', async () => {
    const call = async (tool) => {
      // This is the shape mobile-mcp 0.0.55 actually returns (server.js:296).
      if (tool === 'mobile_get_screen_size') return 'Screen size is 1080x1920 pixels';
      return {};
    };
    const bridge = new DeviceBridge({ call });
    expect(await bridge.getScreenSize()).toEqual({ width: 1080, height: 1920 });
  });

  test('also accepts a structured {width,height} shape', async () => {
    const call = async (tool) => {
      if (tool === 'mobile_get_screen_size') return { width: 1080, height: 1920 };
      return {};
    };
    const bridge = new DeviceBridge({ call });
    expect(await bridge.getScreenSize()).toEqual({ width: 1080, height: 1920 });
  });

  test('hard-fails (never NaN) when the size is unreadable', async () => {
    const call = async () => 'no dimensions here';
    const bridge = new DeviceBridge({ call });
    await expect(bridge.getScreenSize()).rejects.toThrow(/screen size/i);
  });
});

describe('swipe with coordinates', () => {
  test('forwards optional x/y/distance and omits absent keys', async () => {
    const calls = [];
    const call = async (tool, args) => { calls.push([tool, args]); return {}; };
    const bridge = new DeviceBridge({ call });
    await bridge.swipe({ direction: 'right', x: 1, y: 960, distance: 648 });
    expect(calls).toEqual([['mobile_swipe_on_screen', { direction: 'right', x: 1, y: 960, distance: 648 }]]);

    calls.length = 0;
    await bridge.swipe({ direction: 'down' });
    expect(calls).toEqual([['mobile_swipe_on_screen', { direction: 'down' }]]);
  });
});
