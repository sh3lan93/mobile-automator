'use strict';

class McpBridge {
  constructor({ call }) {
    if (typeof call !== 'function') {
      throw new TypeError('McpBridge requires a `call` function (toolName, args) => Promise');
    }
    this._call = call;
  }

  async listElementsOnScreen() {
    return this._call('mobile_list_elements_on_screen', {});
  }

  async takeScreenshot(destPath) {
    const r = await this._call('mobile_save_screenshot', { path: destPath });
    return r.path || destPath;
  }

  async startScreenRecording() {
    return this._call('mobile_start_screen_recording', {});
  }

  async stopScreenRecording() {
    const r = await this._call('mobile_stop_screen_recording', {});
    return r.path;
  }

  async getCrash() {
    return this._call('mobile_get_crash', {});
  }

  async listAvailableDevices() {
    return this._call('mobile_list_available_devices', {});
  }

  async launchApp(packageName, locale) {
    return this._call('mobile_launch_app', { packageName, locale });
  }

  async getScreenSize() {
    return this._call('mobile_get_screen_size', {});
  }
}

module.exports = { McpBridge };
