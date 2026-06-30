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
};

function ok(data, hint = null) {
  const env = { ok: true, data, schema_version: SCHEMA_VERSION };
  // A success can still carry an advisory hint (e.g. recovered corruption).
  // The key is only present when there is something to say, so the common
  // case stays the bare {ok,data,schema_version} envelope.
  if (hint) env.hint = hint;
  return env;
}

function fail(kind, message, hint = null) {
  return {
    ok: false,
    error: { kind, message },
    hint,
    schema_version: SCHEMA_VERSION,
  };
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
    let line;
    if (Array.isArray(data)) {
      line = `ok: ${data.length} item(s)`;
    } else if (data && typeof data === 'object') {
      const keys = Object.keys(data);
      line = `ok: ${keys.length ? keys.join(', ') : '(no data)'}`;
    } else {
      line = `ok: ${String(data)}`;
    }
    if (envelope.hint) {
      line += `\nhint: ${envelope.hint}`;
    }
    return line;
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
