'use strict';

// Structural guard: the result schema, the ResultStore, and the `mauto result`
// verb surface must agree. A fact the schema can hold but no verb can supply
// fails HERE instead of silently emitting null/[]/0 in every result file (#140).

const fs = require('fs');
const path = require('path');

const { RESULT_CAPABILITIES, IDENTITY_FLAGS } = require('../../src/result/capability-catalog');
const { ResultStore } = require('../../src/result/store');
const { OBSERVATION_TYPES } = require('../../src/result/flags');
const { buildProgram } = require('../../src/cli');

const REPO = path.join(__dirname, '..', '..');
const schema = require('../../src/schemas/result_schema.json');
const storeSource = fs.readFileSync(path.join(REPO, 'src', 'result', 'store.js'), 'utf8');

function resolvePointer(pointer) {
  return pointer
    .split('/')
    .filter(Boolean)
    .reduce((node, key) => (node == null ? node : node[key]), schema);
}

const resultCmd = buildProgram().commands.find((c) => c.name() === 'result');
const subcommand = (name) => resultCmd.commands.find((c) => c.name() === name);
const longFlags = (cmd) => new Set(cmd.options.map((o) => o.long));

const capabilities = Object.entries(RESULT_CAPABILITIES);

describe('result coverage — schema ↔ store ↔ verbs', () => {
  test('the `result` command group is registered', () => {
    expect(resultCmd).toBeDefined();
  });

  describe.each(capabilities)('%s', (name, def) => {
    test('the result schema has a home for it', () => {
      expect(resolvePointer(def.schemaPointer)).toBeDefined();
    });

    test('a ResultStore method writes it', () => {
      expect(typeof ResultStore.prototype[def.store]).toBe('function');
      // ...and store.js actually references the field that method must write
      // (catches a method that exists but wires up the wrong property).
      expect(storeSource).toContain(def.writes);
    });

    test('a registered `result` verb exposes every flag that reaches it', () => {
      const cmd = subcommand(def.verb);
      expect(cmd).toBeDefined();
      const flags = longFlags(cmd);
      const missing = def.flags.filter((f) => !flags.has(f));
      expect(missing).toEqual([]);
    });
  });

  test('no orphan flags — every result verb flag is identity or claimed by a capability', () => {
    const claimed = new Set(capabilities.flatMap(([, def]) => def.flags));
    const orphans = [];
    for (const sub of resultCmd.commands) {
      for (const flag of longFlags(sub)) {
        if (!IDENTITY_FLAGS.has(flag) && !claimed.has(flag)) {
          orphans.push(`${sub.name()} ${flag}`);
        }
      }
    }
    expect(orphans).toEqual([]);
  });

  test('OBSERVATION_TYPES matches the schema enum exactly', () => {
    const enumValues = resolvePointer('/properties/observations/items/properties/type/enum');
    expect([...OBSERVATION_TYPES].sort()).toEqual([...enumValues].sort());
  });
});
