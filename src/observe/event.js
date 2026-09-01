'use strict';

// Single source of truth for every field a mauto observability event can
// carry, and — critically — whether that field may ever cross a network.
//
// This mirrors src/device/action-catalog.js and src/result/capability-catalog.js:
// one entry per item, consumed by a lint guard (tests/lint/telemetry-redaction.test.js)
// so a field that gains a network path fails the build instead of silently
// shipping a user's unreleased app id to a third party.
//
//   sends: true  — may appear in slice 5's telemetry payload. Only enumerated
//                  values, counts, versions and durations qualify.
//   sends: false — local logs only. telemetryPayload() cannot serialize it.
//
// The allowlist direction is deliberate: a field nobody has classified is
// silently DROPPED from telemetry rather than silently sent.

const pkg = require('../../package.json');

const EVENT_VERSION = 1;

// Ascending severity. Index order is the comparison order.
const LEVELS = ['debug', 'info', 'warn', 'error'];

const EVENT_FIELDS = {
  // --- ambient, stamped by makeEvent -------------------------------------
  ts: { sends: true, why: 'ISO timestamp; carries no user content' },
  v: { sends: true, why: 'event schema version' },
  mauto_version: { sends: true, why: 'our own package version' },
  node: { sends: true, why: 'node runtime version' },
  os: { sends: true, why: 'process.platform; one of a fixed set' },

  // --- classification ----------------------------------------------------
  level: { sends: true, why: 'enumerated: debug|info|warn|error' },
  src: { sends: true, why: 'enumerated: cli|daemon' },
  event: { sends: true, why: 'enumerated event name' },

  // --- outcome -----------------------------------------------------------
  verb: { sends: true, why: 'the mauto verb name; a fixed vocabulary we ship' },
  ok: { sends: true, why: 'boolean outcome' },
  error_kind: { sends: true, why: 'enumerated envelope taxonomy (device|timeout|...)' },
  exit_code: { sends: true, why: 'enumerated exit code' },
  dur_ms: { sends: true, why: 'duration; carries no user content' },

  // --- local only: every one of these can carry user content -------------
  run_id: { sends: false, why: 'agent-chosen; routinely names an unreleased feature' },
  scenario_id: { sends: false, why: "names the user's feature under test" },
  app_id: { sends: false, why: "an unreleased product's package name" },
  device_id: { sends: false, why: 'hardware identifier / serial' },
  device_model: { sends: false, why: 'narrows a device to an individual tester' },
  project_name: { sends: false, why: "the user's project name" },
  message: { sends: false, why: 'free text; may embed labels, paths, typed input' },
  hint: { sends: false, why: 'free text; may embed filesystem paths' },
  path: { sends: false, why: 'filesystem path; leaks usernames and project layout' },
};

// Names that must ALWAYS be sends:false. Kept separate from EVENT_FIELDS so
// the guard tests a stated intention against the catalog rather than reading
// the catalog and agreeing with itself.
const NEVER_SENDS = [
  'run_id',
  'scenario_id',
  'app_id',
  'device_id',
  'device_model',
  'project_name',
  'message',
  'hint',
  'path',
];

// Build an event from caller fields. Unknown keys are dropped (not an error:
// a caller that invents a field must not be able to smuggle it into a log),
// and undefined values are omitted so events stay sparse rather than
// null-padded.
function makeEvent(fields = {}) {
  const out = {
    ts: new Date().toISOString(),
    v: EVENT_VERSION,
    mauto_version: pkg.version,
    node: process.version,
    os: process.platform,
  };
  for (const [k, val] of Object.entries(fields)) {
    if (!Object.prototype.hasOwnProperty.call(EVENT_FIELDS, k)) continue;
    if (val === undefined) continue;
    out[k] = val;
  }
  return out;
}

// The ONLY function permitted to build a network payload. Allowlist by
// construction: it iterates the catalog, never the event.
function telemetryPayload(event = {}) {
  const out = {};
  for (const [name, def] of Object.entries(EVENT_FIELDS)) {
    if (!def.sends) continue;
    if (!Object.prototype.hasOwnProperty.call(event, name)) continue;
    if (event[name] === undefined) continue;
    out[name] = event[name];
  }
  return out;
}

module.exports = { EVENT_VERSION, LEVELS, EVENT_FIELDS, NEVER_SENDS, makeEvent, telemetryPayload };
