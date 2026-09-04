'use strict';

// The mobile-mcp primitives mauto actually calls, as a closed set.
//
// It exists so `tool` can be sends:true in the event catalog. That field's
// justification — an enumerated primitive name — is only true if the recorded
// value is enforced to be one, exactly as `verb` is enforced against
// commander's resolved command rather than argv (see src/observe/event.js).
// The daemon's `tool` arrives inside a socket frame and the daemon's socket is
// reachable by anything on the machine, so an unchecked value is caller-
// supplied text.
//
// tests/lint/mobile-mcp-tool-coverage.test.js pins this set to the primitives
// src/device/bridge.js calls, in BOTH directions, so neither a new bridge call
// nor a stale entry can drift. Slice 4's crash verb adds mobile_get_crash /
// mobile_list_crashes here in the same change that adds them to the bridge.

const MOBILE_MCP_TOOLS = Object.freeze(
  new Set([
    'mobile_list_available_devices',
    'mobile_list_elements_on_screen',
    'mobile_save_screenshot',
    'mobile_click_on_screen_at_coordinates',
    'mobile_long_press_on_screen_at_coordinates',
    'mobile_double_tap_on_screen',
    'mobile_type_keys',
    'mobile_swipe_on_screen',
    'mobile_get_screen_size',
    'mobile_press_button',
    'mobile_launch_app',
    'mobile_install_app',
    'mobile_uninstall_app',
    'mobile_open_url',
    'mobile_set_orientation',
  ])
);

function isKnownTool(name) {
  return typeof name === 'string' && MOBILE_MCP_TOOLS.has(name);
}

module.exports = { MOBILE_MCP_TOOLS, isKnownTool };
