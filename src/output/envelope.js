'use strict';

// Stable contract between the `mauto` CLI and any calling agent.
// Every command prints exactly one envelope on stdout.

const SCHEMA_VERSION = '2.1';

const EXIT = {
  OK: 0,
  DEVICE: 2,
  INVALID_INPUT: 3,
  TARGET_NOT_FOUND: 4,
  CANCEL: 130,
};

// error.kind -> process exit code. `internal` (and anything unknown) -> 1.
const KIND_TO_CODE = {
  ok: EXIT.OK,
  device: EXIT.DEVICE,
  invalid_input: EXIT.INVALID_INPUT,
  target_not_found: EXIT.TARGET_NOT_FOUND,
  cancel: EXIT.CANCEL,
  internal: 1,
  // `init --agent all` partial failure: some hosts wired, some failed. Non-zero
  // so callers/CI treat it as a failure; the envelope's data.agents[] is honest.
  partial: 1,
};

function ok(data) {
  return { ok: true, data, schema_version: SCHEMA_VERSION };
}

function fail(kind, message, hint = null, data = undefined) {
  const env = {
    ok: false,
    error: { kind, message },
    hint,
    schema_version: SCHEMA_VERSION,
  };
  // Some failures carry actionable structured detail (e.g. a per-agent
  // ok/failed map for `init --agent all`); include `data` only when given so
  // the common fail shape is unchanged.
  if (data !== undefined) env.data = data;
  return env;
}

function exitCodeFor(kind) {
  if (Object.prototype.hasOwnProperty.call(KIND_TO_CODE, kind)) {
    return KIND_TO_CODE[kind];
  }
  return 1;
}

function render(envelope, { human = false } = {}) {
  if (!human) {
    return JSON.stringify(envelope);
  }

  if (envelope.ok) {
    const data = envelope.data;
    if (Array.isArray(data)) {
      return `ok: ${data.length} item(s)`;
    }
    if (data && typeof data === 'object') {
      const keys = Object.keys(data);
      return `ok: ${keys.length ? keys.join(', ') : '(no data)'}`;
    }
    return `ok: ${String(data)}`;
  }

  const { kind, message } = envelope.error || {};
  let out = `error [${kind}]: ${message}`;
  if (envelope.hint) {
    out += `\nhint: ${envelope.hint}`;
  }
  return out;
}

module.exports = {
  SCHEMA_VERSION,
  EXIT,
  ok,
  fail,
  exitCodeFor,
  render,
};
