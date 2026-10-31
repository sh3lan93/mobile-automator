'use strict';

// Pure parsers for the composite `result` flags (#140). Kept free of
// commander and the filesystem so the fiddly cases — a message that itself
// contains a colon, a captured value that contains '=' — are unit-testable
// in isolation. Each parser returns { value } or { error }; callers turn
// `error` into a fail('invalid_input', …) envelope so an unknown observation
// type is rejected loudly instead of being silently dropped.

// Mirrors the enum at /properties/observations/items/properties/type in
// src/schemas/result_schema.json. tests/lint/result-coverage.test.js asserts
// the two never drift.
const OBSERVATION_TYPES = ['regression', 'flakiness', 'state_context'];

function parseObservation(spec) {
  const raw = String(spec);
  const idx = raw.indexOf(':');
  if (idx === -1) {
    return { error: `--observation "${raw}" must be <type>:<message>` };
  }
  const type = raw.slice(0, idx).trim();
  // Split on the FIRST colon only: observation messages routinely contain
  // colons ("dark mode: reference was light").
  const message = raw.slice(idx + 1).trim();
  if (!OBSERVATION_TYPES.includes(type)) {
    return {
      error: `unknown observation type "${type}" (expected ${OBSERVATION_TYPES.join(' | ')})`,
    };
  }
  if (!message) return { error: `--observation "${raw}" has an empty message` };
  return { value: { type, message } };
}

function parseCapture(spec) {
  const raw = String(spec);
  const idx = raw.indexOf('=');
  if (idx === -1) return { error: `--capture "${raw}" must be <name>=<value>` };
  const name = raw.slice(0, idx).trim();
  // NOT trimmed and NOT rejected when empty: a captured field can legitimately
  // be the empty string, and trimming would corrupt a captured value.
  const value = raw.slice(idx + 1);
  if (!name) return { error: `--capture "${raw}" has an empty variable name` };
  return { value: { name, value } };
}

function parseBool(raw, flagName) {
  if (raw === 'true') return { value: true };
  if (raw === 'false') return { value: false };
  return { error: `${flagName} must be "true" or "false" (got "${raw}")` };
}

// Mirrors the enum at /properties/status in src/schemas/result_schema.json;
// tests/lint/result-coverage.test.js asserts the two never drift. `result
// finalize --status` must be one of these or omitted (omission derives the
// status from the recorded assertions): an unlisted value used to be persisted
// verbatim — a schema-invalid result file with a green exit — directly under
// the exit-6 contract keyed on that status (#286 review).
const RUN_STATUSES = ['passed', 'failed', 'error'];

function parseRunStatus(raw) {
  if (!RUN_STATUSES.includes(raw)) {
    return { error: `unknown --status "${raw}" (expected ${RUN_STATUSES.join(' | ')})` };
  }
  return { value: raw };
}

module.exports = { OBSERVATION_TYPES, parseObservation, parseCapture, parseBool, RUN_STATUSES, parseRunStatus };
