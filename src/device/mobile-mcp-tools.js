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

// The vocabulary, as a frozen ARRAY, exported only so the lint guard can
// enumerate it in both directions.
//
// Deliberately not a frozen Set. Object.freeze on a Set is decorative: a Set's
// entries live in its [[SetData]] internal slot, which `.add` / `.delete` /
// `.clear` mutate without ever consulting the object's extensibility, so
// freezing reaches only the Set's own properties. The result reports
// Object.isFrozen === true over a wide-open allowlist, which is worse than an
// unfrozen set — a reader who checks is actively misled. On an array the
// entries ARE ordinary indexed properties, so the freeze is real: push throws
// (it must define a property on a non-extensible object) and no element
// assignment can land.
const MOBILE_MCP_TOOL_NAMES = Object.freeze([
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
]);

// The structure isKnownTool actually queries is module-PRIVATE, and that — not
// the freeze above — is what closes the set. Freezing protects the enumeration;
// withholding the reference protects the decision. No consumer can hold the
// thing `.has()` is called on, so there is nothing to call `.add()` on.
// tests/lint/mobile-mcp-tool-coverage.test.js attempts the widening and the
// narrowing through every export and then asks isKnownTool for the verdict.
const TOOL_SET = new Set(MOBILE_MCP_TOOL_NAMES);

function isKnownTool(name) {
  return typeof name === 'string' && TOOL_SET.has(name);
}

module.exports = { MOBILE_MCP_TOOL_NAMES, isKnownTool };
