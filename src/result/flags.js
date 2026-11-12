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

// Mirrors the enum at /properties/steps_executed/items/properties/status in
// src/schemas/result_schema.json; tests/lint/result-coverage.test.js asserts
// the mapping's outputs never drift from that enum (every accepted spelling
// lands on a schema value, every schema value is reachable). The CLI accepts
// the friendly spellings an agent types (pass/fail/skip) alongside the
// schema's own values; anything else is rejected instead of being silently
// recorded as 'error' (#286 review).
const STEP_STATUS_ALIASES = {
  pass: 'passed',
  passed: 'passed',
  fail: 'failed',
  failed: 'failed',
  skipped: 'skipped',
  skip: 'skipped',
  error: 'error',
};

// The throwing form, for the store: addStep's input is already validated at
// the CLI boundary (parseStepStatus), so reaching this with an unknown value
// means a CLI bug — it escapes as `internal` (exit 1), never as a
// mislabelled-but-green step.
function stepStatus(raw) {
  const normalized = STEP_STATUS_ALIASES[raw];
  if (!normalized) throw new Error(`unknown step status "${raw}"`);
  return normalized;
}

function parseStepStatus(raw) {
  const normalized = STEP_STATUS_ALIASES[raw];
  if (!normalized) {
    return { error: `unknown --status "${raw}" (expected pass | fail | skipped | error)` };
  }
  return { value: normalized };
}

// `result add-assertion --pass` / `--judge` (#275, B3), parsed as one unit
// because the two flags constrain each other: `--pass` is a decided verdict or
// `pending` (recorded `needs_agent`, to be decided later by an agent).
//
// Returns `{ value: { status, judge } }` or `{ error }`. `status` is the
// assertion status to record; `judge` is undefined (no claim made — a caller
// that predates the flag writes exactly what it always wrote) or `{by}`. A
// pending verdict was decided by nobody, so it records `{by: 'none'}` and
// refuses `agent`; a decided verdict refuses `none`.
const VERDICT_STATUSES = { true: 'passed', false: 'failed', pending: 'needs_agent' };

// Who an agent may say decided a verdict (`--judge`). The schema's judge.by
// enum also has `mauto`, which only the in-process runner writes: an agent
// claiming mauto decided would be the self-attestation the field exists to
// expose.
const JUDGES = ['agent', 'none'];

function parseAssertionVerdict(passRaw, judgeRaw) {
  if (!Object.prototype.hasOwnProperty.call(VERDICT_STATUSES, passRaw)) {
    return { error: `--pass must be true | false | pending (got "${passRaw}")` };
  }
  if (judgeRaw !== undefined && !JUDGES.includes(judgeRaw)) {
    return { error: `--judge must be ${JUDGES.join(' | ')} (got "${judgeRaw}")` };
  }
  const status = VERDICT_STATUSES[passRaw];
  if (status === 'needs_agent') {
    if (judgeRaw === 'agent') return { error: '--judge agent needs a verdict: use --pass true or --pass false' };
    return { value: { status, judge: { by: 'none' } } };
  }
  if (judgeRaw === 'none') {
    return { error: `--judge none means nobody decided, but --pass is ${passRaw}: use --pass pending or --judge agent` };
  }
  return { value: { status, judge: judgeRaw === 'agent' ? { by: 'agent' } : undefined } };
}

// Mirrors the enum at /properties/status in src/schemas/result_schema.json;
// tests/lint/result-coverage.test.js asserts the two never drift. `result
// finalize --status` must be one of these or omitted (omission derives the
// status from the recorded steps and assertions): an unlisted value used to be persisted
// verbatim — a schema-invalid result file with a green exit — directly under
// the exit-6 contract keyed on that status (#286 review).
const RUN_STATUSES = ['passed', 'failed', 'error', 'incomplete'];

function parseRunStatus(raw) {
  if (!RUN_STATUSES.includes(raw)) {
    return { error: `unknown --status "${raw}" (expected ${RUN_STATUSES.join(' | ')})` };
  }
  return { value: raw };
}

module.exports = {
  OBSERVATION_TYPES,
  parseObservation,
  parseCapture,
  JUDGES,
  parseAssertionVerdict,
  RUN_STATUSES,
  parseRunStatus,
  STEP_STATUS_ALIASES,
  stepStatus,
  parseStepStatus,
};
