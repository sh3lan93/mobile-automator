'use strict';

// Structural guard: the result schema may only ever GROW.
//
// tests/lint/schema-additive.test.js does this for the SCENARIO schema. The
// result schema had no equivalent, and result-coverage.test.js is not one: it
// asks "can an agent fill this field?", not "did this change invalidate result
// files that are already on disk?".
//
// Result files are the tool's durable output. A user's CI keeps last month's
// runs and src/memory/store.js harvests them into run-history, so narrowing a
// type, dropping an enum value, or adding a `required` field retroactively
// breaks data nobody can regenerate.
//
// The baseline is tests/fixtures/result_schema_v2.0.json — a byte-copy of the
// schema as it stood before slice 3 added anything, created FIRST for exactly
// that reason.

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const BASELINE = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'result_schema_v2.0.json'), 'utf8')
);
const CURRENT = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'schemas', 'result_schema.json'), 'utf8')
);

// Walk both trees in lockstep, yielding one entry per OBJECT node the baseline
// defines. `cur` is undefined wherever the current schema has dropped that node
// — which every check below treats as a failure rather than as "nothing to
// compare", because a silently absent node is the whole thing being prevented.
//
// Inside a `properties` or `patternProperties` bag, the keys are FIELD NAMES,
// not schema keywords — so a field may legitimately be called `type`, `enum`,
// `required`, or anything else that means something different one level up.
// (`observations.items.properties.type` is one today: the observation's own
// `regression`/`flakiness`/`state_context` discriminator.) Yielding the bag
// itself as a checkable node would read that field's subschema as if it were
// THIS node's `type`/`enum`/`required` keyword and report a narrowing that
// never happened. So the bag is skipped as a node; its children — the real
// field subschemas — are not, and are checked exactly as before.
const PROPERTY_BAG_KEYS = new Set(['properties', 'patternProperties']);

function* walk(base, cur, pointer = '', skip = false) {
  if (base === null || typeof base !== 'object' || Array.isArray(base)) return;
  if (!skip) yield { pointer: pointer || '/', base, cur };
  for (const key of Object.keys(base)) {
    const child = base[key];
    if (child === null || typeof child !== 'object' || Array.isArray(child)) continue;
    yield* walk(
      child,
      cur && typeof cur === 'object' ? cur[key] : undefined,
      `${pointer}/${key}`,
      PROPERTY_BAG_KEYS.has(key)
    );
  }
}

// A JSON Schema `type` is a string or an array of strings. Normalize so
// "widened" and "narrowed" are set questions rather than two shapes.
function typeSet(node) {
  if (!node || node.type === undefined) return null;
  return new Set(Array.isArray(node.type) ? node.type : [node.type]);
}

const nodes = [...walk(BASELINE, CURRENT)];

function narrowedTypes(walker, base, cur) {
  const found = [];
  for (const { pointer, base: b, cur: c } of walker(base, cur)) {
    const before = typeSet(b);
    if (!before || !c) continue;
    const after = typeSet(c) || new Set();
    for (const t of before) {
      if (!after.has(t)) found.push(pointer);
    }
  }
  return found;
}

// Pins the properties-bag fix above with a fixture that is deliberately NOT
// the real schema, so this stays true regardless of what result_schema.json
// happens to contain. `walk()` without the bag skip is reproduced inline
// rather than imported, so the second test only fails if the production
// `walk()` regains the bug it demonstrates.
describe('walk() does not misread a field literally named "type" as this node\'s type keyword', () => {
  const withTypeField = {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['a', 'b'] },
      other: { type: 'string' },
    },
    required: ['type'],
  };

  function* walkWithoutBagSkip(base, cur, pointer = '') {
    if (base === null || typeof base !== 'object' || Array.isArray(base)) return;
    yield { pointer: pointer || '/', base, cur };
    for (const key of Object.keys(base)) {
      const child = base[key];
      if (child === null || typeof child !== 'object' || Array.isArray(child)) continue;
      yield* walkWithoutBagSkip(child, cur && typeof cur === 'object' ? cur[key] : undefined, `${pointer}/${key}`);
    }
  }

  it('the production walk() reports no narrowing for an unchanged schema with a "type" field', () => {
    const cur = JSON.parse(JSON.stringify(withTypeField));
    expect(narrowedTypes(walk, withTypeField, cur)).toEqual([]);
  });

  it('would report a false narrowing here if the properties-bag skip were ever removed', () => {
    const cur = JSON.parse(JSON.stringify(withTypeField));
    expect(narrowedTypes(walkWithoutBagSkip, withTypeField, cur)).not.toEqual([]);
  });
});

describe('result schema is additive over v2.0', () => {
  it('has a non-trivial baseline to compare against', () => {
    // Guards the guard: an empty or truncated fixture would make every check
    // below vacuously pass.
    expect(Object.keys(BASELINE.properties).length).toBeGreaterThan(10);
    expect(nodes.length).toBeGreaterThan(20);
  });

  it('every v2.0 node still exists at the same pointer', () => {
    const dropped = nodes.filter((n) => n.cur === undefined).map((n) => n.pointer);
    expect(dropped).toEqual([]);
  });

  it('no v2.0 enum value was removed', () => {
    const removed = [];
    for (const { pointer, base, cur } of nodes) {
      if (!Array.isArray(base.enum) || !cur) continue;
      const current = Array.isArray(cur.enum) ? cur.enum : [];
      for (const value of base.enum) {
        if (!current.includes(value)) removed.push(`${pointer}/enum: ${value}`);
      }
    }
    expect(removed).toEqual([]);
  });

  it('no v2.0 type was narrowed', () => {
    const narrowed = [];
    for (const { pointer, base, cur } of nodes) {
      const before = typeSet(base);
      if (!before || !cur) continue;
      const after = typeSet(cur) || new Set();
      for (const t of before) {
        if (!after.has(t)) narrowed.push(`${pointer}/type: ${t}`);
      }
    }
    expect(narrowed).toEqual([]);
  });

  // `required` is checked for EQUALITY, not containment, because the two
  // directions break different readers and both are breaking. Growing it
  // retroactively invalidates every result file already on disk; shrinking it
  // lets a new file omit a field every consumer is entitled to assume is there.
  it('no required list grew or shrank', () => {
    const changed = [];
    for (const { pointer, base, cur } of nodes) {
      if (!Array.isArray(base.required) || !cur) continue;
      const before = [...base.required].sort();
      const after = [...(cur.required || [])].sort();
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        changed.push(`${pointer}/required: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
      }
    }
    expect(changed).toEqual([]);
  });

  it('still accepts schema_version "2.0"', () => {
    // const today, enum if a 2.1 ever lands — same shape the scenario guard
    // uses, so a future version bump extends this rather than rewriting it.
    const node = CURRENT.properties.schema_version;
    const accepted = node.const !== undefined ? [node.const] : node.enum || [];
    expect(accepted).toContain('2.0');
  });

  // The checks above are structural. This one is behavioural, and it is the
  // one that would actually have caught a subtle break: a schema can satisfy
  // every rule above and still reject a document, through a keyword none of
  // them models. A file that used to validate and now does not IS the failure.
  it('a v2.0-era result document still validates against the current schema', () => {
    // validateFormats:false — ajv 8 ships no format implementations, and this
    // guard is about structure, not about whether `date-time` parses.
    const ajv = new Ajv({ strict: false, validateFormats: false });
    const validate = ajv.compile(CURRENT);
    const legacy = {
      run_id: 'run_20260101_120000',
      schema_version: '2.0',
      scenario_id: 'login_smoke',
      metadata: {
        app_version: '1.0.0',
        device_model: 'Pixel 7',
        api_level: '34',
        environment: 'staging',
        timestamp: '2026-01-01T12:00:00.000Z',
      },
      status: 'passed',
      total_assertions: 1,
      passed_assertions: 1,
      failed_assertions: 0,
      duration_seconds: 42,
      captured_variables: {},
      steps_executed: [
        {
          step_id: 'tap_login',
          status: 'passed',
          screenshot: null,
          error_message: null,
          retried: false,
          retry_count: 0,
          observations: null,
        },
      ],
      assertion_results: [
        { assertion_id: 'a1', status: 'passed', expected: null, actual: null, message: 'ok' },
      ],
      observations: [],
      summary: 'passed: 1/1 assertion(s) passed across 1 step(s).',
    };
    validate(legacy);
    expect(validate.errors || []).toEqual([]);
  });
});
