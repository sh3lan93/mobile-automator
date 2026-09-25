'use strict';

// The check that makes a `sends: true` classification TRUE.
//
// A `sends: true` field used to carry a `basis` word — computed, closed-set,
// csprng, constant — as a pure self-declaration. Nothing tied the word to the
// value: telemetryPayload() copied whatever was on the event, and the lint
// guard only checked that the word was in a list. So a new field could write
// `basis: 'computed'` and ship `com.acme.unreleased` without any test noticing.
//
// Here the basis is DERIVED instead. Each helper below returns a predicate
// tagged with the kind of guarantee it enforces, and `sendable()` reads the
// catalog entry's `basis` off that tag. There is no hand-written basis string
// left to lie with, and telemetryPayload() (src/observe/event.js) applies the
// predicate to every value before it can reach the wire.
//
// Predicates are TOTAL: they take any value — an object, NaN, a getter-free
// hostile string — and answer true or false, never throw. Each is a positive
// check ("is one of these", "matches exactly this shape") rather than a
// rejection list, so an unforeseen value fails closed.

// The closed set of mechanisms that can make a `sends: true` classification
// true. Each is what one helper below enforces:
//
//   'computed'   — a number, boolean or timestamp this code derives, checked
//                  for type and range. Never a string copied from a caller.
//   'closed-set' — the value is one of a fixed vocabulary we define or a
//                  runtime-level enum (os, errno). See src/observe/vocab.js.
//   'csprng'     — a zero-arity CSPRNG token, checked for its exact shape.
//   'constant'   — a fixed fact about the build/runtime (a version string),
//                  checked for its shape, never for equality with the running
//                  process: an event spooled before an upgrade is flushed after
//                  it, and must not be dropped for being from the old version.
const SEND_BASES = ['computed', 'closed-set', 'csprng', 'constant'];

function tag(fn, basis) {
  if (!SEND_BASES.includes(basis)) throw new Error(`unknown telemetry basis: ${basis}`);
  fn.basis = basis;
  return Object.freeze(fn);
}

// value is exactly one of `list`. The list is copied into a private Set, so a
// consumer that mutates the array it passed cannot widen the check later.
function oneOf(list) {
  const set = new Set(list);
  return tag((value) => typeof value === 'string' && set.has(value), 'closed-set');
}

// value is a string with exactly the shape `regex` describes. `basis` says why
// that shape is a guarantee: 'csprng' for random tokens, 'constant' for version
// strings. Anchor the regex — an unanchored one accepts a match anywhere in
// caller text.
function matches(regex, basis) {
  if (basis !== 'csprng' && basis !== 'constant') {
    throw new Error(`matches() basis must be 'csprng' or 'constant', got ${basis}`);
  }
  return tag((value) => typeof value === 'string' && regex.test(value), basis);
}

// value is an integer in [min, max]. The default max is MAX_SAFE_INTEGER, which
// is what rejects 1e21 (an integer to Number.isInteger, and not one we minted).
function integer({ min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}, basis = 'computed') {
  if (basis !== 'computed' && basis !== 'constant') {
    throw new Error(`integer() basis must be 'computed' or 'constant', got ${basis}`);
  }
  return tag((value) => Number.isInteger(value) && value >= min && value <= max, basis);
}

function boolean() {
  return tag((value) => typeof value === 'boolean', 'computed');
}

// What Date#toISOString mints, and only that: a string of this exact shape that
// Date.parse also reads as a real instant (so month 13 fails).
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
function isoTimestamp() {
  return tag(
    (value) => typeof value === 'string' && ISO_TIMESTAMP.test(value) && Number.isFinite(Date.parse(value)),
    'computed'
  );
}

// The catalog-entry builder. `basis` is read OFF the check, never restated.
function sendable(accepts, why) {
  if (typeof accepts !== 'function' || !SEND_BASES.includes(accepts.basis)) {
    throw new Error('sendable() needs a check built by an accepts helper');
  }
  return { sends: true, basis: accepts.basis, accepts, why };
}

// PURE: the names of `sends: true` entries in `catalog` whose classification is
// not backed by an enforced check — no `accepts` function, a basis outside
// SEND_BASES, or a basis that disagrees with the check it sits on. Empty for a
// sound catalog. Takes the catalog as an argument so a test can hand it a
// doctored CLONE and prove a lying entry is caught (tests/lint/telemetry-redaction.test.js)
// without ever mutating the real one.
function findUnenforced(catalog) {
  return Object.entries(catalog)
    .filter(([, def]) => def && def.sends === true)
    .filter(([, def]) => {
      if (typeof def.accepts !== 'function') return true;
      if (!SEND_BASES.includes(def.basis)) return true;
      return def.accepts.basis !== def.basis;
    })
    .map(([name]) => name);
}

module.exports = { SEND_BASES, oneOf, matches, integer, boolean, isoTimestamp, sendable, findUnenforced };
