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

const FALLBACK = '(not configured — run `mauto config set <key> …`)';

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
  additional_resources: {
    keys: ['additional_resources', 'knowledge.additional_resources'],
    prefix: '\n',
  },

  // ---- aware only ----
  app_package: { keys: ['android_package', 'app.android_package', 'ios_bundle_id', 'app.ios_bundle_id'] },
  architecture: { keys: ['architecture', 'knowledge.architecture'] },
  platform_details: { keys: ['platform_details', 'knowledge.platform_details', 'platform'] },
  build_system: { keys: ['build_system', 'knowledge.build_system'] },
  build_command: { keys: ['build_command', 'knowledge.build_command'] },
  automation_extras: { keys: ['automation_extras', 'knowledge.automation_extras'] },
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
    if (!spec) return FALLBACK;
    const raw = firstDefined(projectRoot, spec.keys);
    const rendered = renderValue(raw, spec);
    return rendered === undefined ? FALLBACK : rendered;
  });
}

module.exports = { interpolate, PLACEHOLDER_KEYS, FALLBACK };
