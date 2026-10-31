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
//                   method that calls one or more mobile-mcp primitives
//                   (`primitive` for one, `primitives` for an ordered sequence;
//                   read either through primitivesOf).
//   'semantic'    — invoked via `mauto press <action>`; resolved to per-platform
//                   mechanics by src/device/semantic-press (see ACTION_METHOD).
//   'composed'    — no dedicated verb; the agent composes it from existing verbs
//                   (e.g. poll `mauto elements`, repeat `mauto swipe`). The
//                   execute guide documents the composition.
//   'unsupported' — no `mauto` verb reaches it: the engine has no primitive, or
//                   (clear_app_data, since 1.0.15) mauto has not wired it. Not
//                   mechanically executable; the guide must NOT promise a verb,
//                   and the agent reports it honestly / handles it manually.
//
// For 'verb' entries, `args` documents the mobile-mcp argument keys the bridge
// method must pass — deliberately explicit because the keys are inconsistent
// across the engine (launch=packageName, uninstall=packageName, install=path).
//
// `requiresTarget` (every step-enum action; precondition-only actions omit it)
// says whether the step locates an element, so needs a `target` or
// `target_pattern`. `waitAction: true` marks the actions the schema's
// `wait_config` configures. targetActions()/waitActions() derive both sets.
//
// `stepFlags` records a scenario step field that changes how the verb runs:
// `{ field, value, flag }` means "when step[field] === value, pass flag". This
// is the one place the mapping lives; the E2E harness derives the flags via
// stepFlagsFor and tests/lint/action-coverage.test.js checks the field, the
// verb's option and both execute guides against it.
//
// `warnWhenUnset` on a stepFlags entry names the advisory finding code for a
// step that leaves `field` unset: the field's schema default selects the
// no-flag behaviour, so an unset field is ambiguous about the author's intent.
// implicitStepFlags derives those entries; src/scenario/replayability.js turns
// them into findings and owns the wording and severity for each code.

const ACTION_CATALOG = {
  // --- direct verbs (engine-backed) --------------------------------------
  tap: {
    requiresTarget: true,
    resolution: 'verb', verb: 'tap', bridge: 'tap',
    primitive: 'mobile_click_on_screen_at_coordinates', args: ['x', 'y'],
  },
  long_press: {
    requiresTarget: true,
    resolution: 'verb', verb: 'long-press', bridge: 'longPress',
    primitive: 'mobile_long_press_on_screen_at_coordinates', args: ['x', 'y', 'duration?'],
  },
  double_tap: {
    requiresTarget: true,
    resolution: 'verb', verb: 'double-tap', bridge: 'doubleTap',
    primitive: 'mobile_double_tap_on_screen', args: ['x', 'y'],
  },
  type: {
    requiresTarget: false,
    resolution: 'verb', verb: 'type', bridge: 'type',
    primitive: 'mobile_type_keys', args: ['text', 'submit'],
  },
  swipe: {
    requiresTarget: false,
    resolution: 'verb', verb: 'swipe', bridge: 'swipe',
    primitive: 'mobile_swipe_on_screen', args: ['direction'],
  },
  press_button: {
    requiresTarget: false,
    resolution: 'verb', verb: 'press', bridge: 'pressButton',
    primitive: 'mobile_press_button', args: ['button'],
  },
  launch_app: {
    // Cold start (#255): restartApp terminates, then launches.
    requiresTarget: false,
    resolution: 'verb', verb: 'launch', bridge: 'restartApp',
    primitives: ['mobile_terminate_app', 'mobile_launch_app'], args: ['packageName'],
    // `cold: false` opts out of the restart (#255).
    stepFlags: [{ field: 'cold', value: false, flag: '--resume', warnWhenUnset: 'launch_cold_implicit' }],
  },
  install_app: {
    resolution: 'verb', verb: 'install', bridge: 'installApp',
    primitive: 'mobile_install_app', args: ['path'],
  },
  uninstall_app: {
    resolution: 'verb', verb: 'uninstall', bridge: 'uninstallApp',
    primitive: 'mobile_uninstall_app', args: ['packageName'],
  },
  open_url: {
    requiresTarget: false,
    resolution: 'verb', verb: 'open-url', bridge: 'openUrl',
    primitive: 'mobile_open_url', args: ['url'],
  },
  set_orientation: {
    resolution: 'verb', verb: 'orientation', bridge: 'setOrientation',
    primitive: 'mobile_set_orientation', args: ['orientation'],
  },

  // --- semantic (mauto press <action>, platform-resolved) ----------------
  press_back: { requiresTarget: false, resolution: 'semantic', verb: 'press' },
  dismiss_keyboard: { requiresTarget: false, resolution: 'semantic', verb: 'press' },
  grant_permission: { requiresTarget: false, resolution: 'semantic', verb: 'press' },
  deny_permission: { requiresTarget: false, resolution: 'semantic', verb: 'press' },

  // --- composed (agent builds from existing verbs; no dedicated verb) -----
  scroll_to_element: { requiresTarget: true, resolution: 'composed' },
  wait_for_element: { requiresTarget: true, waitAction: true, resolution: 'composed' },
  wait_for_element_gone: { requiresTarget: true, waitAction: true, resolution: 'composed' },
  wait_for_loading_complete: { requiresTarget: false, waitAction: true, resolution: 'composed' },
  capture_value: { requiresTarget: true, resolution: 'composed' },

  // --- unsupported (no mobile-mcp 1.0.5 primitive) -----------------------
  clear_app_data: { requiresTarget: false, resolution: 'unsupported' },
  enable_wifi: { resolution: 'unsupported' },
  disable_wifi: { resolution: 'unsupported' },
};

// Steps that locate an element on screen (tap, waits, scroll, capture) need a
// `target` or `target_pattern`; the scenario referential checks read this set.
function targetActions() {
  return Object.keys(ACTION_CATALOG).filter((a) => ACTION_CATALOG[a].requiresTarget === true);
}

// Steps the schema's `wait_config` configures.
function waitActions() {
  return Object.keys(ACTION_CATALOG).filter((a) => ACTION_CATALOG[a].waitAction === true);
}

const RESOLUTIONS = ['verb', 'semantic', 'composed', 'unsupported'];

function actionsByResolution(resolution) {
  return Object.keys(ACTION_CATALOG).filter((a) => ACTION_CATALOG[a].resolution === resolution);
}

// The mobile-mcp primitives a 'verb' entry's bridge method calls, in order.
function primitivesOf(def) {
  if (!def) return [];
  if (Array.isArray(def.primitives)) return def.primitives.slice();
  return def.primitive ? [def.primitive] : [];
}

// The verb flags a scenario step's fields select for `action`, derived from
// the entry's `stepFlags`. [] when the action has none or is unknown.
function stepFlagsFor(action, step) {
  const def = Object.prototype.hasOwnProperty.call(ACTION_CATALOG, action) ? ACTION_CATALOG[action] : null;
  if (!def || !Array.isArray(def.stepFlags) || !step || typeof step !== 'object') return [];
  return def.stepFlags.filter((sf) => step[sf.field] === sf.value).map((sf) => sf.flag);
}

// The stepFlags entries carrying a `warnWhenUnset` marker whose field the step
// leaves unset (not an own property). [] for an unknown action or a non-object
// step.
function implicitStepFlags(action, step) {
  const def = ACTION_CATALOG[action];
  if (!def || !Array.isArray(def.stepFlags) || !step || typeof step !== 'object') return [];
  return def.stepFlags.filter((sf) => sf.warnWhenUnset
    && !Object.prototype.hasOwnProperty.call(step, sf.field));
}

module.exports = {
  ACTION_CATALOG, RESOLUTIONS, actionsByResolution, primitivesOf, stepFlagsFor, implicitStepFlags,
  targetActions, waitActions,
};
