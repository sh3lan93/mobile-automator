'use strict';

// Structural guard: no field that can carry user content may ever gain a
// network path. Scenario ids and app package names are users' unreleased
// product names; device ids are hardware identifiers. A denylist name that
// flips to sends:true fails HERE rather than shipping to a third party.

const {
  EVENT_FIELDS,
  NEVER_SENDS,
  SEND_BASES,
  makeEvent,
  telemetryPayload,
  findUnenforced,
} = require('../../src/observe/event');

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

// ---------------------------------------------------------------------------
// `basis` used to be a bare self-declaration: telemetryPayload() copied ANY
// value for a sends:true field, and the guard above only checked that the
// declared word was in a list. A review proved it by shipping
// `event:'/Users/alice/acme-unreleased/x'` and `error_kind:'password=hunter2'`
// verbatim, and by adding a NEW field {sends:true,basis:'computed'} that passed
// every guard and put `com.acme.unreleased` on the wire. Everything below tests
// that the classification is now ENFORCED at the wire, not merely claimed.
// ---------------------------------------------------------------------------

const SENDS_TRUE = Object.keys(EVENT_FIELDS).filter((k) => EVENT_FIELDS[k].sends);

// One legitimate value per sends:true field. Doubles as the round-trip fixture
// and as the completeness check that this file covers every sends:true field.
const VALID = {
  ts: '2026-09-25T10:00:00.000Z',
  v: 1,
  mauto_version: '0.26.0-rc.4',
  node: 'v22.1.0',
  os: 'darwin',
  level: 'info',
  src: 'daemon',
  event: 'call.end',
  verb: 'tap',
  ok: true,
  error_kind: 'device',
  exit_code: 2,
  dur_ms: 12,
  session_id: '8f2c1a3b4d5e6f70',
  tool: 'mobile_press_button',
  call_id: 7,
  stop_reason: 'idle',
  error_code: 'EADDRINUSE',
  crash_count: 1,
  msg_id: 'b3a1c0de4f5a6b7c8d9e0f1a2b3c4d5e',
  count: 3,
  http_status: 200,
};

// The values a caller-controlled or hand-edited source could put on a field.
const LYING = {
  ts: 'com.acme.ts',
  v: 'x',
  mauto_version: 'com.acme',
  node: 'x',
  os: 'x',
  level: 'com.acme',
  src: '/etc/passwd',
  event: '/Users/alice/acme-unreleased/x',
  verb: 'com.acme.secret',
  ok: 'com.acme',
  error_kind: 'password=hunter2',
  exit_code: 'x',
  dur_ms: 'x',
  session_id: 'app=com.acme',
  tool: 'com.acme.secret',
  call_id: 'x',
  stop_reason: 'scenario checkout-v2',
  error_code: 'com.acme.secret',
  crash_count: 'x',
  msg_id: 'com.acme',
  count: 'x',
  http_status: 'x',
};

describe('the sends:true classification is enforced, not declared', () => {
  it('flags no sends:true field in the real catalog', () => {
    expect(findUnenforced(EVENT_FIELDS)).toEqual([]);
  });

  it('flags the exact probe that once passed every guard: a bare {sends:true,basis:"computed"} field', () => {
    // Tests the tester. A CLONE, never the real catalog.
    const clone = {
      ...EVENT_FIELDS,
      app_bundle: { sends: true, basis: 'computed', why: 'computed; carries no user content' },
    };
    expect(findUnenforced(clone)).toEqual(['app_bundle']);
  });

  it('flags a basis that disagrees with the check it sits on, and one outside SEND_BASES', () => {
    const lying = { ...EVENT_FIELDS, ts: { ...EVENT_FIELDS.ts, basis: 'csprng' } };
    expect(findUnenforced(lying)).toEqual(['ts']);
    const unknown = { ...EVENT_FIELDS, ts: { ...EVENT_FIELDS.ts, basis: 'vibes' } };
    expect(findUnenforced(unknown)).toEqual(['ts']);
  });

  it('flags an accepts that is not a function, and ignores sends:false entries', () => {
    const bad = { ...EVENT_FIELDS, ts: { ...EVENT_FIELDS.ts, accepts: 'yes' } };
    expect(findUnenforced(bad)).toEqual(['ts']);
    const local = { ...EVENT_FIELDS, note: { sends: false, why: 'local only' } };
    expect(findUnenforced(local)).toEqual([]);
  });

  it('gives every sends:true field a check whose kind matches its declared basis', () => {
    for (const name of SENDS_TRUE) {
      const def = EVENT_FIELDS[name];
      expect(typeof def.accepts).toBe('function');
      expect(def.accepts.basis).toBe(def.basis);
      expect(SEND_BASES).toContain(def.basis);
    }
  });

  describe('probe: no sends:true field accepts a value it could not have minted', () => {
    // true/false are deliberately NOT probes: `ok` legitimately accepts them.
    const PROBES = [
      ['a path-shaped app id', 'com.acme.unreleased /Users/alice/x'],
      ['an object', {}],
      ['an array', []],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['null', null],
      ['undefined', undefined],
      ['-1', -1],
      ['1e21', 1e21],
    ];
    for (const name of SENDS_TRUE) {
      for (const [label, value] of PROBES) {
        it(`${name} rejects ${label}`, () => {
          expect(EVENT_FIELDS[name].accepts(value)).toBe(false);
        });
      }
    }
  });

  it('has a legitimate value for every sends:true field, so the round trip below is complete', () => {
    expect(Object.keys(VALID).sort()).toEqual([...SENDS_TRUE].sort());
    for (const name of SENDS_TRUE) expect(EVENT_FIELDS[name].accepts(VALID[name])).toBe(true);
  });

  it('round-trips a fully valid event through the wire, every field intact', () => {
    expect(telemetryPayload({ ...VALID })).toEqual(VALID);
  });

  it('sends nothing at all when every sends:true field carries a lying value', () => {
    expect(Object.keys(LYING).sort()).toEqual([...SENDS_TRUE].sort());
    expect(telemetryPayload({ ...LYING })).toEqual({});
  });

  it('sends none of the lying values when they are fed through makeEvent (ambient fields are stamped)', () => {
    const payload = telemetryPayload(makeEvent({ ...LYING }));
    for (const [name, lie] of Object.entries(LYING)) {
      expect(payload[name]).not.toBe(lie);
    }
    // The stamped ambient values are real and DO go out; nothing else does.
    expect(Object.keys(payload).sort()).toEqual(['mauto_version', 'node', 'os', 'ts', 'v']);
  });

  it('drops a lying value but still sends the honest fields beside it', () => {
    const payload = telemetryPayload({ ...VALID, event: '/Users/alice/acme-unreleased/x' });
    expect(payload).not.toHaveProperty('event');
    expect(payload.verb).toBe('tap');
  });

  it('validates SHAPE, not equality with this process, so an event spooled before an upgrade still ships', () => {
    const old = telemetryPayload({ ...VALID, mauto_version: '0.1.0', node: 'v18.0.0' });
    expect(old.mauto_version).toBe('0.1.0');
    expect(old.node).toBe('v18.0.0');
  });

  it('rejects an out-of-range or fractional integer field', () => {
    for (const bad of [{ exit_code: 256 }, { http_status: 99 }, { http_status: 600 }, { call_id: 0 }, { v: 0 }, { dur_ms: 1.5 }]) {
      const [k] = Object.keys(bad);
      expect(telemetryPayload({ ...VALID, ...bad })).not.toHaveProperty(k);
    }
  });
});
