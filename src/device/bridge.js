'use strict';

const { normalize } = require('./element-model');

// Thin wrapper over an injected mobile-mcp `call(toolName, args)` function.
// Mirrors tools/recorder/src/capture/mobile-mcp-bridge.js but returns the
// agnostic element model and exposes only the primitives Slice 1 needs.
class DeviceBridge {
  constructor({ call }) {
    if (typeof call !== 'function') {
      throw new TypeError('DeviceBridge requires a `call` function (toolName, args) => Promise');
    }
    this._call = call;
  }

  async listElements() {
    const result = await this._call('mobile_list_elements_on_screen', {});
    const raw = Array.isArray(result) ? result : (result && result.elements) || [];
    return normalize(raw);
  }

  async screenshot(destPath) {
    const result = await this._call('mobile_save_screenshot', { path: destPath });
    return (result && result.path) || destPath;
  }
}

module.exports = { DeviceBridge };
