'use strict';

// Resolves whether telemetry is on, and owns the consent copy.
//
// Precedence, in this order and for these reasons:
//
//   1. MAUTO_TELEMETRY=0   a kill switch must win over everything, and it is
//                          checked FIRST so it costs zero filesystem calls.
//   2. DO_NOT_TRACK=1      the cross-tool convention, honoured.
//   3. telemetry.enabled   the project's opt-in, in its config.json.
//   4. local consent       this user's own record, outside the repository
//                          (src/observe/consent.js).
//   5. a real token         a placeholder build cannot post even if enabled.
//
// MAUTO_TELEMETRY=1 deliberately does NOT enable. An off-switch is safe to
// honour from the environment; an on-switch is a way to turn collection on for
// a machine — a CI image, a shared shell profile, an inherited Dockerfile —
// whose owner never consented.
//
// For the same reason the on-switch is the config key AND (4), never the key
// alone (#348). A file the project owner edits is a file anyone can commit: a
// committed `enabled: true` used to turn telemetry on for everyone who cloned
// the repo. The config key says the project allows it; only the per-user
// record, which no repository can write, says this person agreed.

const configManager = require('../config/manager');
const { hasLocalConsent, setLocalConsent } = require('./consent');
const { EVENT_FIELDS, NEVER_SENDS } = require('./event');
const { hasToken } = require('./transport');

const REASONS = Object.freeze([
  'kill_switch',
  'do_not_track',
  'not_configured',
  'not_consented_locally',
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
  '',
  'Turning it on records your consent for this project on this machine only,',
  'in a file outside the repository, so a committed config cannot turn it on',
  'for anyone else.',
  '',
  'The device engine mauto drives (mobile-mcp) has telemetry of its own, and it',
  'is off too: mauto starts it with MOBILEMCP_DISABLE_TELEMETRY=1.',
].join('\n');

function envKillSwitch(env = process.env) {
  if (String((env && env.MAUTO_TELEMETRY) || '') === '0') return 'kill_switch';
  const dnt = String((env && env.DO_NOT_TRACK) || '').toLowerCase();
  if (dnt === '1' || dnt === 'true') return 'do_not_track';
  return null;
}

// Whether the project's config opts in: a LITERAL true. A truthy string
// ("true", "1") means someone hand-edited the file into a shape `mauto config
// set` would never produce, and guessing at intent is not something a consent
// flag gets to do.
function configOptIn(config) {
  return Boolean(config && config.telemetry && config.telemetry.enabled === true);
}

// The precedence above, written once. The readers are called lazily, in this
// order, so a kill switch costs no filesystem call and the consent record is
// read only when the config opts in. `readConsent` is this user's per-user
// record for the project (see src/observe/consent.js), and it too must return
// a literal true.
function resolveTelemetry({
  env = process.env,
  loadConfig = () => null,
  readConsent = () => false,
} = {}) {
  const killed = envKillSwitch(env);
  if (killed) return { enabled: false, reason: killed };
  if (!configOptIn(loadConfig())) return { enabled: false, reason: 'not_configured' };
  if (readConsent() !== true) return { enabled: false, reason: 'not_consented_locally' };
  if (!hasToken(env)) return { enabled: false, reason: 'no_token' };
  return { enabled: true, reason: 'enabled' };
}

// The device engine's own telemetry (#213). mobile-mcp sends a PostHog event
// per tool call and a scarf.sh pixel per process unless
// MOBILEMCP_DISABLE_TELEMETRY is set, and its gate is a plain truthiness check:
// any non-empty string turns it off, and only an empty string leaves it on.
//
// mauto's own telemetry is opt-in, so an engine mauto spawns must not be
// opt-out — the default here is off. The user's opt-in is the engine's own
// variable, passed through verbatim the way #212 passes through
// MOBILEMCP_ALLOW_UNSAFE_URLS: if they set it at all, even to '', they meant
// it. The env kill switches still win, because they promise "nothing leaves
// this machine", and a promise with an exception is not one.
//
// One function decides, and both buildEngineEnv (what the engine receives) and
// `mauto telemetry status` (what the user is told) call it, so the env and the
// report cannot disagree.
function resolveEngineTelemetry(env = process.env) {
  const killed = envKillSwitch(env);
  if (killed) return { disableValue: '1', enabled: false, reason: killed };
  const value = env && env.MOBILEMCP_DISABLE_TELEMETRY;
  if (value === undefined) return { disableValue: '1', enabled: false, reason: 'default_off' };
  return { disableValue: value, enabled: value === '', reason: 'user_env' };
}

// The decision for a project, taken now: no cache. The one place the
// precedence meets the filesystem.
function decideNow(projectRoot, env = process.env) {
  try {
    return resolveTelemetry({
      env,
      loadConfig: () => configManager.load(projectRoot),
      readConsent: () => hasLocalConsent(projectRoot, { env }),
    });
  } catch (_) {
    // A corrupt or unreadable config resolves OFF. Failing closed is the only
    // acceptable direction for a consent flag.
    return { enabled: false, reason: 'not_configured' };
  }
}

// decideNow, cached per project root for at most DECISION_MAX_AGE_MS. The
// decision reads config.json (and the consent record), and a file read per
// event is not acceptable on a path that runs on every verb, so it is cached;
// and a cache that never expires is what let a running daemon keep sending
// after the user withdrew consent (#348), so it expires.
//
// A one-shot verb, whose writes land within the same second, therefore reads
// once; a long-lived caller (the daemon) re-reads at most once a second. A
// clock that steps backwards re-reads rather than trusting a decision of
// unknown age.
const DECISION_MAX_AGE_MS = 1000;
const cache = new Map();

function decideForProject(projectRoot, env = process.env) {
  const key = String(projectRoot);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now >= hit.at && now - hit.at < DECISION_MAX_AGE_MS) return hit.decision;
  const decision = decideNow(projectRoot, env);
  cache.set(key, { decision, at: now });
  return decision;
}

// The write behind `mauto telemetry enable|disable`: the config key, then this
// user's consent record. The config goes first so a disable takes effect even
// if the consent write then fails (which propagates, so the verb reports it).
// A write through the module that owns the decision also invalidates it, so no
// caller can forget a pairing it never sees; the delete is in a finally so a
// failed write cannot leave a stale decision, and it is surgical: the affected
// root's key only; other roots' cached decisions survive.
//
// `mauto config set telemetry.enabled` does not come through here, by
// decision (#348): it changes the project's config, and consent is a separate,
// per-user act that only `mauto telemetry enable` records. It goes through
// setConfigOptIn below.
function setEnabled(projectRoot, value, env = process.env) {
  writeInvalidating(projectRoot, () => {
    configManager.set(projectRoot, 'telemetry.enabled', value);
    setLocalConsent(projectRoot, value, { env });
  });
}

// The write behind `mauto config set telemetry.enabled`: the config key only,
// never the consent record. Owned here so it invalidates the cached decision
// like setEnabled does.
function setConfigOptIn(projectRoot, value) {
  writeInvalidating(projectRoot, () => configManager.set(projectRoot, 'telemetry.enabled', value));
}

// Every write through this module drops that root's cached decision, in a
// finally so a failed write cannot leave a stale one behind.
function writeInvalidating(projectRoot, write) {
  try {
    write();
  } finally {
    cache.delete(String(projectRoot));
  }
}

// Test isolation only: production writes go through setEnabled above. Kept
// because a test process is long-lived where a verb process is not, and one
// cache spans every workspace the suite builds.
function _resetMemo() {
  cache.clear();
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
  resolveEngineTelemetry,
  decideNow,
  decideForProject,
  DECISION_MAX_AGE_MS,
  setEnabled,
  setConfigOptIn,
  _resetMemo,
  sentFields,
  neverSentFields,
};
