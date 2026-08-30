'use strict';

// Placeholder interpolation for ported guide prose.
//
// Guide content files (src/guide/content/*.md) carry `{{token}}` placeholders
// lifted verbatim from the Gemini SKILL templates. At emit time we replace every
// token with a config-derived value so the agent reads concrete, project-specific
// prose. A token with no backing config value falls back to a clear "not
// configured" note — guaranteeing NO `{{` survives, which the guide lint guards
// enforce.
//
// PLACEHOLDER_KEYS maps each placeholder name to the config lookup(s) used to
// resolve it. It is exported so the execute port (slice 5) reuses the
// same contract instead of re-deriving it.

const configManager = require('../config/manager');

// How an UNSET placeholder renders has to fit the sentence it lands in. A
// single context-blind string cannot: the 13 placeholder sites in the aware
// guides occupy at least five grammatical roles (label value, inline noun,
// parenthetical appositive, inline tail, whole section body). There are two
// kinds of slot, and they want opposite things.
//
//   VALUE slots — `**Platform:** {{platform_details}}`, `the app package
//   ({{app_package}})`. These want a short noun phrase naming the key to set.
//   Critically it must carry NO parentheses of its own: the prose already
//   supplies them where they belong, so a self-parenthesizing fallback rendered
//   `the app package ((not configured …))` — the same class of malformation
//   #143 set out to remove, in a different shape.
//
//   OPTIONAL slots — `the `mauto` CLI{{automation_extras}}.` and the trailing
//   `{{additional_resources}}` bullet. These are additive prose; when there is
//   nothing to add, the correct rendering is NOTHING. A diagnostic jammed onto
//   the preceding word (`the `mauto` CLI(not configured …).`) is strictly worse
//   than silence.
const FALLBACK = 'not configured';

// The fallback also used to read `set it via mauto config set <key>` with
// `<key>` left LITERAL — so the guide told the agent to run a command with a
// placeholder still in it, 13 times, and never named the missing key. The
// candidate list knows the key, so name it.
function fallbackFor(spec) {
  if (!spec) return FALLBACK; // unknown token — nothing to name
  if (spec.optional) return '';
  return `${FALLBACK} — mauto config set ${spec.keys[0]}`;
}

// Each entry lists candidate config keys, tried in order. The config may be in
// the flat agnostic shape (top-level keys) or the nested aware shape written by
// setup (app.*, knowledge.*) — we probe both so one map serves every shape.
//
// `join: true`  -> array values are rendered as a comma-joined list.
// `prefix`      -> rendered as `${prefix}${value}` when a value is present
//                  (used by automation_extras / additional_resources, which in
//                  the original prose are inline tails like ", plus adb").
const PLACEHOLDER_KEYS = {
  // ---- shared (aware + agnostic) ----
  project_name: { keys: ['project_name', 'knowledge.project_name'] },
  loading_indicators: { keys: ['loading_indicators', 'knowledge.loading_indicators'] },
  protected_directories: {
    keys: ['protected_directories', 'knowledge.protected_directories'],
    join: true,
  },
  // `optional: true` -> renders as nothing when unset (see FALLBACK above).
  additional_resources: {
    keys: ['additional_resources', 'knowledge.additional_resources'],
    prefix: '\n',
    optional: true,
  },

  // ---- aware only ----
  app_package: { keys: ['android_package', 'app.android_package', 'ios_bundle_id', 'app.ios_bundle_id'] },
  architecture: { keys: ['architecture', 'knowledge.architecture'] },
  platform_details: { keys: ['platform_details', 'knowledge.platform_details', 'platform'] },
  build_system: { keys: ['build_system', 'knowledge.build_system'] },
  build_command: { keys: ['build_command', 'knowledge.build_command'] },
  // An inline tail (", plus adb") appended to "the `mauto` CLI" — optional, so
  // an unset value ends the sentence cleanly instead of jamming a note onto it.
  automation_extras: {
    keys: ['automation_extras', 'knowledge.automation_extras'],
    optional: true,
  },
  environments: { keys: ['environments'], join: true },

  // ---- agnostic only ----
  business_domain: { keys: ['business_domain', 'knowledge.business_domain'] },
  business_critical_paths: {
    keys: ['business_critical_paths', 'knowledge.business_critical_paths'],
    join: true,
  },
};

function firstDefined(projectRoot, keys) {
  // No project root (e.g. lint guards emit guides without one) -> no config,
  // every placeholder takes the fallback. Never let config I/O throw here.
  if (!projectRoot) return undefined;
  for (const k of keys) {
    const v = configManager.get(projectRoot, k);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function renderValue(value, spec) {
  if (value === undefined) return undefined;
  let out;
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined;
    out = spec.join ? value.join(', ') : value.join(', ');
  } else {
    out = String(value);
  }
  if (spec.prefix) out = `${spec.prefix}${out}`;
  return out;
}

// interpolate(template, { projectRoot, mode })
// Replaces every {{token}} in `template`. Known placeholders resolve from config
// (per PLACEHOLDER_KEYS); known-but-unset and entirely unknown tokens both fall
// back to FALLBACK, so the returned string never contains `{{`.
function interpolate(template, { projectRoot, mode } = {}) {
  // `mode` is accepted for symmetry with emitGuide and future per-mode tweaks;
  // resolution today is mode-agnostic (the candidate-key probing covers both).
  void mode;
  return String(template).replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, name) => {
    const spec = PLACEHOLDER_KEYS[name];
    const rendered = spec ? renderValue(firstDefined(projectRoot, spec.keys), spec) : undefined;
    return rendered === undefined ? fallbackFor(spec) : rendered;
  });
}

module.exports = { interpolate, PLACEHOLDER_KEYS, FALLBACK, fallbackFor };
