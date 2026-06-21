'use strict';

const { McpBridge } = require('../../../tools/recorder/src/capture/mobile-mcp-bridge');

describe('McpBridge', () => {
  test('forwards listElementsOnScreen to underlying call', async () => {
    const calls = [];
    // Return a properly-shaped mobile-mcp 0.0.55 fixture (string format + coordinates)
    // so the parse+map+filter pipeline produces a visible element.
    const fixture = 'Found these elements on screen: ' + JSON.stringify([
      { type: 'Button', text: 'OK', label: '', identifier: 'btn_ok', coordinates: { x: 0, y: 0, width: 100, height: 100 } },
    ]);
    const fakeCall = async (toolName, args) => {
      calls.push({ toolName, args });
      return fixture;
    };
    const bridge = new McpBridge({ call: fakeCall });
    const result = await bridge.listElementsOnScreen();
    expect(calls).toHaveLength(1);
    expect(calls[0].toolName).toBe('mobile_list_elements_on_screen');
    expect(result.elements[0].text).toBe('OK');
  });

  test('takeScreenshot returns path string from mobile-mcp call', async () => {
    const fakeCall = async () => ({ path: '/tmp/screenshot.png' });
    const bridge = new McpBridge({ call: fakeCall });
    const out = await bridge.takeScreenshot('/tmp/screenshot.png');
    expect(out).toBe('/tmp/screenshot.png');
  });

  test('startScreenRecording / stopScreenRecording happy path', async () => {
    const calls = [];
    const fakeCall = async (toolName) => {
      calls.push(toolName);
      if (toolName === 'mobile_start_screen_recording') return { ok: true };
      if (toolName === 'mobile_stop_screen_recording') return { path: '/tmp/rec.mp4' };
    };
    const bridge = new McpBridge({ call: fakeCall });
    await bridge.startScreenRecording();
    const path = await bridge.stopScreenRecording();
    expect(path).toBe('/tmp/rec.mp4');
    expect(calls).toEqual(['mobile_start_screen_recording', 'mobile_stop_screen_recording']);
  });

  test('throws descriptive error if underlying call rejects', async () => {
    const fakeCall = async () => { throw new Error('device disconnected'); };
    const bridge = new McpBridge({ call: fakeCall });
    await expect(bridge.listElementsOnScreen())
      .rejects.toThrow(/device disconnected/);
  });

  test('launchApp forwards packageName and locale to mobile_launch_app and returns result', async () => {
    const calls = [];
    const fakeCall = async (toolName, args) => {
      calls.push({ toolName, args });
      return { ok: true };
    };
    const bridge = new McpBridge({ call: fakeCall });
    const result = await bridge.launchApp('com.example.app', 'en-US');
    expect(calls).toHaveLength(1);
    expect(calls[0].toolName).toBe('mobile_launch_app');
    expect(calls[0].args).toEqual({ packageName: 'com.example.app', locale: 'en-US' });
    expect(result).toEqual({ ok: true });
  });

  test('launchApp propagates rejection from underlying call', async () => {
    const fakeCall = async () => { throw new Error('device disconnected'); };
    const bridge = new McpBridge({ call: fakeCall });
    await expect(bridge.launchApp('com.example.app', 'en-US'))
      .rejects.toThrow(/device disconnected/);
  });

  test('launchApp works without a locale argument (locale undefined)', async () => {
    const calls = [];
    const fakeCall = async (toolName, args) => {
      calls.push({ toolName, args });
      return { ok: true };
    };
    const bridge = new McpBridge({ call: fakeCall });
    await bridge.launchApp('com.example.app');
    expect(calls).toHaveLength(1);
    expect(calls[0].toolName).toBe('mobile_launch_app');
    expect(calls[0].args).toEqual({ packageName: 'com.example.app', locale: undefined });
  });
});

test('listElementsOnScreen parses mobile-mcp string + maps to resolver shape', async () => {
  const fixture = 'Found these elements on screen: ' + JSON.stringify([
    { type: 'android.widget.Button', text: '', label: 'Smart Watch', identifier: 'home_product_card_p002', coordinates: { x: 640, y: 804, width: 640, height: 853 } },
  ]);
  const bridge = new McpBridge({ call: async () => fixture });
  const snap = await bridge.listElementsOnScreen();
  expect(snap.elements).toHaveLength(1);
  expect(snap.elements[0].accessibility_label).toBe('Smart Watch');
  expect(snap.elements[0].bounds).toEqual([640, 804, 1280, 1657]);
});
