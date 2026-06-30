'use strict';

const { normalize, parseElements } = require('./element-model');
const { normalizeDevices } = require('./device-model');
const { resolveSingleDevice } = require('./device-resolver');

// Thin wrapper over an injected mobile-mcp `call(toolName, args)` function.
// Returns the agnostic element model and exposes only the primitives the CLI needs.
class DeviceBridge {
  constructor({ call, device = null }) {
    if (typeof call !== 'function') {
      throw new TypeError('DeviceBridge requires a `call` function (toolName, args) => Promise');
    }
    this._call = call;
    this._device = device;
  }

  // Enumerate connected devices/simulators via mobile-mcp and return the
  // agnostic device model (id/name/platform/state only). Tolerates both a bare
  // array and the { devices: [...] } envelope mobile-mcp may return.
  async listDevices() {
    const result = await this._call('mobile_list_available_devices', {});
    return normalizeDevices(result);
  }

  async listElements() {
    const result = await this._call('mobile_list_elements_on_screen', {});
    return normalize(parseElements(result));
  }

  async screenshot(destPath) {
    // mobile-mcp's save-screenshot tool names the destination `saveTo` (not
    // `path`); passing the wrong key makes it a silent no-op that still reports
    // success. It returns a confirmation string, so we resolve to destPath.
    const result = await this._call('mobile_save_screenshot', { saveTo: destPath });
    return (result && result.path) || destPath;
  }

  // Tap at absolute screen coordinates. The agent derives x,y from listElements
  // centers, so the bridge stays free of any element targeting logic.
  async tap({ x, y } = {}) {
    return this._call('mobile_click_on_screen_at_coordinates', { x, y });
  }

  // Long-press at absolute screen coordinates. Optional duration (ms) overrides
  // mobile-mcp's 500ms default; absent it is not sent so the default applies.
  async longPress({ x, y, duration } = {}) {
    const args = { x, y };
    if (duration !== undefined) args.duration = duration;
    return this._call('mobile_long_press_on_screen_at_coordinates', args);
  }

  // Double-tap at absolute screen coordinates.
  async doubleTap({ x, y } = {}) {
    return this._call('mobile_double_tap_on_screen', { x, y });
  }

  // Type into the focused element. We never auto-submit; pressing ENTER is a
  // distinct, explicit action via pressButton.
  async type(text) {
    return this._call('mobile_type_keys', { text, submit: false });
  }

  // Swipe in a cardinal direction. Optional x/y set the start point and
  // distance the travel — used by the iOS edge-swipe back gesture. Absent keys
  // are not sent so the cardinal-from-center default is preserved.
  async swipe({ direction, x, y, distance } = {}) {
    const args = { direction };
    if (x !== undefined) args.x = x;
    if (y !== undefined) args.y = y;
    if (distance !== undefined) args.distance = distance;
    return this._call('mobile_swipe_on_screen', args);
  }

  // Platform ('android'/'ios') of the connected device. Uses the pinned id when
  // one was provided, else the single auto-resolved device.
  async getPlatform() {
    const devices = normalizeDevices(await this._call('mobile_list_available_devices', {}));
    const id = this._device || resolveSingleDevice(devices); // throws DeviceResolutionError on 0/many
    const match = devices.find((d) => d.id === id);
    if (!match || !match.platform) {
      const err = new Error(`Cannot determine the platform of device "${id}".`);
      err.hint = 'Ensure the device is listed by `mauto devices`.';
      throw err;
    }
    return String(match.platform).toLowerCase();
  }

  // Physical screen size in pixels, for geometry-based gestures. mobile-mcp
  // returns this as the human string "Screen size is <w>x<h> pixels" (not an
  // object), so we parse the WxH out of it; a structured {width,height} shape is
  // also accepted in case a future engine returns one. An unreadable size is a
  // hard error — never silently 0/NaN, which would make geometry gestures no-ops.
  async getScreenSize() {
    const r = await this._call('mobile_get_screen_size', {});
    if (r && typeof r === 'object' && r.width != null && r.height != null) {
      return { width: Number(r.width), height: Number(r.height) };
    }
    const m = /(\d+)\s*x\s*(\d+)/i.exec(String(r));
    if (!m) {
      const err = new Error(`Could not read the device screen size from "${r}".`);
      err.hint = 'Ensure a device or simulator is connected.';
      throw err;
    }
    return { width: Number(m[1]), height: Number(m[2]) };
  }

  // Press a hardware/system button (BACK, HOME, ENTER, ...).
  async pressButton(button) {
    return this._call('mobile_press_button', { button });
  }

  // Launch an installed app by its package/bundle identifier.
  async launchApp(packageName) {
    return this._call('mobile_launch_app', { packageName });
  }

  // Install an app from a local artifact (apk/ipa) path.
  async installApp(appPath) {
    return this._call('mobile_install_app', { path: appPath });
  }

  // Uninstall an app by its bundle/package identifier.
  async uninstallApp(appId) {
    return this._call('mobile_uninstall_app', { bundle_id: appId });
  }

  // Open a URL (deep link or web) on the device.
  async openUrl(url) {
    return this._call('mobile_open_url', { url });
  }

  // Set the device orientation ('portrait'/'landscape').
  async setOrientation(orientation) {
    return this._call('mobile_set_orientation', { orientation });
  }
}

module.exports = { DeviceBridge };
