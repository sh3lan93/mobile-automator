'use strict';

// Resolves whether telemetry is on, and owns the consent copy.
//
// Precedence, in this order and for these reasons:
//
//   1. MAUTO_TELEMETRY=0   a kill switch must win over everything, and it is
//                          checked FIRST so it costs zero filesystem calls.
//   2. DO_NOT_TRACK=1      the cross-tool convention, honoured.
//   3. telemetry.enabled   the user's durable, explicit opt-in.
//   4. a real token         a placeholder build cannot post even if enabled.
//
// MAUTO_TELEMETRY=1 deliberately does NOT enable. An off-switch is safe to
// honour from the environment; an on-switch is a way to turn collection on for
// a machine — a CI image, a shared shell profile, an inherited Dockerfile —
// whose owner never consented. On-switches live in a file the project owner
// edits.

const configManager = require('../config/manager');
const { EVENT_FIELDS, NEVER_SENDS } = require('./event');
const { hasToken } = require('./transport');

const REASONS = Object.freeze([
  'kill_switch',
  'do_not_track',
  'not_configured',
  'no_token',
  'enabled',
]);

// The single home for the consent copy. `mauto telemetry status`, the setup
// envelope and docs/reference/telemetry.md all render THIS string; three
// hand-written copies would drift, and the one that drifts is the one a user
// reads before deciding.
//
// It is a NOTICE, never a prompt. mauto verbs are invoked by an agent, not
// typed by a human, so there is nobody at the keyboard to answer a question —
// and an agent answering a consent question on a human's behalf is worse than
// not asking.
const CONSENT_NOTICE = [
  'Telemetry is off by default and nothing is sent until you turn it on.',
  '',
  'When enabled, mauto records anonymous usage counts — which verb ran, whether',
  'it succeeded, how long it took, and the mobile-mcp primitive behind it. It',
  'sends no free text of any kind: no scenario ids, app package names, device',
  'serials, element labels, typed input or filesystem paths. There is no',
  'per-machine identifier; every event is anonymous and uncorrelated.',
  '',
  'Run `mauto telemetry status` to see the exact field list, read from the same',
  'catalog the uploader uses. Run `mauto telemetry enable` to turn it on, or set',
  'MAUTO_TELEMETRY=0 (or DO_NOT_TRACK=1) to force it off everywhere.',
].join('\n');

function envKillSwitch(env = process.env) {
  if (String((env && env.MAUTO_TELEMETRY) || '') === '0') return 'kill_switch';
  const dnt = String((env && env.DO_NOT_TRACK) || '').toLowerCase();
  if (dnt === '1' || dnt === 'true') return 'do_not_track';
  return null;
}

function resolveTelemetry({ env = process.env, config = null } = {}) {
  const killed = envKillSwitch(env);
  if (killed) return { enabled: false, reason: killed };
  // A LITERAL true. A truthy string ("true", "1") means someone hand-edited
  // the file into a shape `mauto config set` would never produce, and guessing
  // at intent is not something a consent flag gets to do.
  const configured = Boolean(config && config.telemetry && config.telemetry.enabled === true);
  if (!configured) return { enabled: false, reason: 'not_configured' };
  if (!hasToken(env)) return { enabled: false, reason: 'no_token' };
  return { enabled: true, reason: 'enabled' };
}

// Memoised per project root. resolveLevels() is re-derived per record() call
// because it reads only env; this one reads config.json, and a file read per
// event is not acceptable on a path that runs on every verb.
//
// The pinning consequence is the same one slice 2 documented for the daemon's
// MAUTO_LOG_LEVEL: for a one-shot verb this is once per process (correct by
// construction), and for the daemon it is once per daemon lifetime. Editing
// config.json while a daemon is running does not change that daemon's
// behaviour; `mauto session end` then re-run is the remedy.
const memo = new Map();

function decideForProject(projectRoot, env = process.env) {
  const key = String(projectRoot);
  if (memo.has(key)) return memo.get(key);
  let decision;
  try {
    // Checked before the read, not after: a kill switch must cost nothing.
    decision = envKillSwitch(env)
      ? resolveTelemetry({ env, config: null })
      : resolveTelemetry({ env, config: configManager.load(projectRoot) });
  } catch (_) {
    // A corrupt or unreadable config resolves OFF. Failing closed is the only
    // acceptable direction for a consent flag.
    decision = { enabled: false, reason: 'not_configured' };
  }
  memo.set(key, decision);
  return decision;
}

// A write through the module that owns the decision also invalidates it, so no
// caller can forget a pairing it never sees. The delete is surgical — the
// affected root's key only; other roots' memoised decisions survive.
//
// `config set` cannot route through this: its raw CLI strings need coerceValue
// first, so that write stays in cli.js. That path does not invalidate, and
// stays harmless for as long as nothing seeds the memo before a handler's own
// report in a one-shot verb process.
function setEnabled(projectRoot, value) {
  configManager.set(projectRoot, 'telemetry.enabled', value);
  memo.delete(String(projectRoot));
}

// Test isolation only: production writes go through setEnabled above. Kept
// because a test process is long-lived where a verb process is not, and one
// memo spans every workspace the suite builds.
function _resetMemo() {
  memo.clear();
}

// The disclosure is COMPUTED from the catalog, never restated. That is what
// makes `mauto telemetry status` and docs/reference/telemetry.md incapable of
// lying: they render the same source of truth telemetryPayload() iterates.
function sentFields() {
  return Object.keys(EVENT_FIELDS).filter((k) => EVENT_FIELDS[k].sends);
}

function neverSentFields() {
  return [...NEVER_SENDS];
}

module.exports = {
  CONSENT_NOTICE,
  REASONS,
  envKillSwitch,
  resolveTelemetry,
  decideForProject,
  setEnabled,
  _resetMemo,
  sentFields,
  neverSentFields,
};
