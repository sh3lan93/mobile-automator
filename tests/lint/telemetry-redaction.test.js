'use strict';

// Structural guard: no field that can carry user content may ever gain a
// network path. Scenario ids and app package names are users' unreleased
// product names; device ids are hardware identifiers. A denylist name that
// flips to sends:true fails HERE rather than shipping to a third party.

const { EVENT_FIELDS, NEVER_SENDS, SEND_BASES, telemetryPayload } = require('../../src/observe/event');

describe('telemetry redaction', () => {
  it('requires every sends:true field to declare a structural basis, not just prose', () => {
    // The three defects this catches have all shipped: `verb` once carried
    // process.argv[2], `tool` needed a pinned allowlist before its
    // justification was true, and `session_id` needed a zero-arity generator
    // before ITS justification was true. A prose `why` string can be reworded
    // to satisfy a reviewer (or a regex) without the underlying value ever
    // becoming safe, so the enforceable claim is a `basis` drawn from a known,
    // closed set of mechanisms — mirroring src/device/action-catalog.js's
    // `resolution` field — with `why` kept alongside it purely as the
    // human-readable explanation of THAT basis, never as the check itself.
    const undeclared = Object.entries(EVENT_FIELDS)
      .filter(([, def]) => def.sends)
      .filter(([, def]) => !SEND_BASES.includes(def.basis))
      .map(([name]) => name);
    expect(undeclared).toEqual([]);
  });
  it('marks every known-sensitive field sends:false', () => {
    const leaked = NEVER_SENDS.filter((f) => EVENT_FIELDS[f] && EVENT_FIELDS[f].sends === true);
    expect(leaked).toEqual([]);
  });

  it('lists every sensitive field in the catalog so the denial is explicit', () => {
    const undeclared = NEVER_SENDS.filter((f) => !EVENT_FIELDS[f]);
    expect(undeclared).toEqual([]);
  });

  it('sends only enumerated values, counts and durations — never free text', () => {
    // A sends:true field must not be one whose value is caller-supplied prose.
    const FREE_TEXT = ['message', 'hint', 'summary', 'label', 'text', 'path'];
    const offending = Object.keys(EVENT_FIELDS)
      .filter((f) => EVENT_FIELDS[f].sends)
      .filter((f) => FREE_TEXT.some((t) => f === t || f.endsWith(`_${t}`)));
    expect(offending).toEqual([]);
  });

  it('drops sensitive values end-to-end', () => {
    const payload = telemetryPayload(
      Object.fromEntries(Object.keys(EVENT_FIELDS).map((k) => [k, `VALUE_${k}`]))
    );
    for (const f of NEVER_SENDS) {
      expect(payload).not.toHaveProperty(f);
    }
  });
});
