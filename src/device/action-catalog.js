'use strict';

// Single source of truth binding every scenario-schema action to HOW it is
// executed. Three things must agree and never drift: the schema's action
// enums (`step.action` + `preconditions.device_actions`), the `mauto` verb
// surface (cli.js + DeviceBridge), and the execute guide's mapping table.
// `tests/lint/action-coverage.test.js` derives its assertions from this map,
// so an action that loses (or never had) a faithful execution path fails the
// build instead of silently degrading at replay time.
//
// `resolution` declares the execution contract for each action:
//   'verb'        — a dedicated one-shot `mauto` verb backed by a DeviceBridge
//                   method that calls a single mobile-mcp primitive.
//   'semantic'    — invoked via `mauto press <action>`; resolved to per-platform
//                   mechanics by src/device/semantic-press (see ACTION_METHOD).
//   'composed'    — no dedicated verb; the agent composes it from existing verbs
//                   (e.g. poll `mauto elements`, repeat `mauto swipe`). The
//                   execute guide documents the composition.
//   'unsupported' — mobile-mcp 0.0.55 exposes no primitive for it. Not
//                   mechanically executable; the guide must NOT promise a verb,
//                   and the agent reports it honestly / handles it manually.
//
// For 'verb' entries, `args` documents the mobile-mcp argument keys the bridge
// method must pass — deliberately explicit because the keys are inconsistent
// across the engine (launch=packageName, uninstall=bundle_id, install=path).

const ACTION_CATALOG = {
  // --- direct verbs (engine-backed) --------------------------------------
  tap: {
    resolution: 'verb', verb: 'tap', bridge: 'tap',
    primitive: 'mobile_click_on_screen_at_coordinates', args: ['x', 'y'],
  },
  long_press: {
    resolution: 'verb', verb: 'long-press', bridge: 'longPress',
    primitive: 'mobile_long_press_on_screen_at_coordinates', args: ['x', 'y', 'duration?'],
  },
  double_tap: {
    resolution: 'verb', verb: 'double-tap', bridge: 'doubleTap',
    primitive: 'mobile_double_tap_on_screen', args: ['x', 'y'],
  },
  type: {
    resolution: 'verb', verb: 'type', bridge: 'type',
    primitive: 'mobile_type_keys', args: ['text', 'submit'],
  },
  swipe: {
    resolution: 'verb', verb: 'swipe', bridge: 'swipe',
    primitive: 'mobile_swipe_on_screen', args: ['direction'],
  },
  press_button: {
    resolution: 'verb', verb: 'press', bridge: 'pressButton',
    primitive: 'mobile_press_button', args: ['button'],
  },
  launch_app: {
    resolution: 'verb', verb: 'launch', bridge: 'launchApp',
    primitive: 'mobile_launch_app', args: ['packageName'],
  },
  install_app: {
    resolution: 'verb', verb: 'install', bridge: 'installApp',
    primitive: 'mobile_install_app', args: ['path'],
  },
  uninstall_app: {
    resolution: 'verb', verb: 'uninstall', bridge: 'uninstallApp',
    primitive: 'mobile_uninstall_app', args: ['bundle_id'],
  },
  open_url: {
    resolution: 'verb', verb: 'open-url', bridge: 'openUrl',
    primitive: 'mobile_open_url', args: ['url'],
  },
  set_orientation: {
    resolution: 'verb', verb: 'orientation', bridge: 'setOrientation',
    primitive: 'mobile_set_orientation', args: ['orientation'],
  },

  // --- semantic (mauto press <action>, platform-resolved) ----------------
  press_back: { resolution: 'semantic', verb: 'press' },
  dismiss_keyboard: { resolution: 'semantic', verb: 'press' },
  grant_permission: { resolution: 'semantic', verb: 'press' },
  deny_permission: { resolution: 'semantic', verb: 'press' },

  // --- composed (agent builds from existing verbs; no dedicated verb) -----
  scroll_to_element: { resolution: 'composed' },
  wait_for_element: { resolution: 'composed' },
  wait_for_element_gone: { resolution: 'composed' },
  wait_for_loading_complete: { resolution: 'composed' },
  capture_value: { resolution: 'composed' },

  // --- unsupported (no mobile-mcp 0.0.55 primitive) ----------------------
  clear_app_data: { resolution: 'unsupported' },
  enable_wifi: { resolution: 'unsupported' },
  disable_wifi: { resolution: 'unsupported' },
};

const RESOLUTIONS = ['verb', 'semantic', 'composed', 'unsupported'];

function actionsByResolution(resolution) {
  return Object.keys(ACTION_CATALOG).filter((a) => ACTION_CATALOG[a].resolution === resolution);
}

module.exports = { ACTION_CATALOG, RESOLUTIONS, actionsByResolution };
