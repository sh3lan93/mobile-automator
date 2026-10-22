'use strict';

// The only place the CLI's Ajv instance is constructed (#191).
//
// There used to be two hand-copied `new Ajv({ allErrors: true, strict: false })`
// literals — one in src/config/schema.js, one in src/scenario/validator.js —
// plus a third mirror in the schema lint guard tied to them by nothing but a
// comment. Three copies of "the CLI's own options" that nothing kept true:
// change the options in src and the guard would keep vouching for the old
// ones. A guard that hand-maintains a copy of the thing it guards is itself a
// drift surface — the same lesson that produced docs-corpus.js.
//
// Everything that needs the CLI's Ajv — both call sites above, the unit tests
// that validate envelopes against the shipped schemas, and
// tests/lint/schemas-valid.test.js, which compiles every schema with the real
// instance — now consumes this factory. That guard also fails on any other
// construction site in src/ or bin/, so the options cannot quietly return as
// literals.

const Ajv = require('ajv');

// allErrors: true — `mauto validate` and config validation report every
// problem in one pass, not just the first one they hit.
// strict: false — result_schema.json declares `format: "date-time"` and no
// instance here registers formats, so strict mode would turn Ajv's warning
// into an error. The CLI tolerates the warning rather than claim format
// checking it does not actually do.
function createCliAjv() {
  return new Ajv({ allErrors: true, strict: false });
}

module.exports = { createCliAjv };
