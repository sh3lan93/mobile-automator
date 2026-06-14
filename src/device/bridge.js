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

  // Tap at absolute screen coordinates. The agent derives x,y from listElements
  // centers, so the bridge stays free of any element targeting logic.
  async tap({ x, y } = {}) {
    return this._call('mobile_click_on_screen_at_coordinates', { x, y });
  }

  // Type into the focused element. We never auto-submit; pressing ENTER is a
  // distinct, explicit action via pressButton.
  async type(text) {
    return this._call('mobile_type_keys', { text, submit: false });
  }

  // Swipe in a cardinal direction (up/down/left/right) from screen center.
  async swipe({ direction } = {}) {
    return this._call('mobile_swipe_on_screen', { direction });
  }

  // Press a hardware/system button (BACK, HOME, ENTER, ...).
  async pressButton(button) {
    return this._call('mobile_press_button', { button });
  }
}

module.exports = { DeviceBridge };
