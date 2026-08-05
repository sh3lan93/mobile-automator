'use strict';

// Structural guard: the result schema, the ResultStore, and the `mauto result`
// verb surface must agree. A fact the schema can hold but no verb can supply
// fails HERE instead of silently emitting null/[]/0 in every result file (#140).

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  RESULT_CAPABILITIES,
  IDENTITY_FLAGS,
  NO_FLAG_ALLOWLIST,
} = require('../../src/result/capability-catalog');
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

// The top-level result-schema property a capability's schemaPointer lives
// under, e.g. '/properties/steps_executed/items/properties/screenshot' -> 'steps_executed'.
function topLevelProperty(pointer) {
  return pointer.split('/').filter(Boolean)[1];
}

function tmpProjectRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-result-coverage-'));
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

    test('a ResultStore method exists for it', () => {
      expect(typeof ResultStore.prototype[def.store]).toBe('function');
    });

    // Only capabilities whose `writes` token is unique to their write site
    // (writeCheck: 'substring') are checked this way — see the writeCheck
    // doc comment in capability-catalog.js. The rest ('behavioral') are
    // proven below by actually running a ResultStore.
    if (def.writeCheck === 'substring') {
      test('store.js contains a write site unique to this capability', () => {
        expect(storeSource).toContain(def.writes);
      });
    }

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

  // The schema-level analogue of the no-orphan-flags check above: every
  // top-level result-schema property must either be claimed by some
  // capability's schemaPointer, or be explicitly allowlisted with a reason.
  // A new schema field with no capability AND no allowlist entry is exactly
  // the #140 signature (a home with no way for an agent to fill it), so this
  // is what makes the catalog's "every FACT" header claim enforced rather
  // than aspirational.
  test('every top-level result-schema property is a capability or an allowlisted no-flag field', () => {
    const claimedTopLevel = new Set(capabilities.map(([, def]) => topLevelProperty(def.schemaPointer)));
    const allowlisted = new Set(Object.keys(NO_FLAG_ALLOWLIST));
    const topLevelProps = Object.keys(schema.properties);
    const uncovered = topLevelProps.filter((p) => !claimedTopLevel.has(p) && !allowlisted.has(p));
    expect(uncovered).toEqual([]);
  });

  test('every NO_FLAG_ALLOWLIST entry carries a non-empty justification', () => {
    for (const [field, reason] of Object.entries(NO_FLAG_ALLOWLIST)) {
      expect(typeof reason).toBe('string');
      expect(reason.trim().length).toBeGreaterThan(0);
      expect(schema.properties).toHaveProperty(field);
    }
  });

  // Fields whose store-level write cannot be proven by a source substring
  // (writeCheck: 'behavioral' — see capability-catalog.js) are instead proven
  // here by actually running a ResultStore against a throwaway project root
  // and checking the field survives into the emitted result.
  describe('behavioral: fields with no unique source token reach the emitted result', () => {
    test('screenshot supplied to addStep reaches the finalized result', () => {
      const store = new ResultStore({ runId: 'run_20260101_000001', scenarioId: 's', projectRoot: tmpProjectRoot() });
      store.addStep({ step_id: 'step_1', status: 'pass', screenshot: 'shots/step1.png' });
      const result = store.finalize({});
      expect(result.steps_executed[0].screenshot).toBe('shots/step1.png');
    });

    test('error_message supplied to addStep reaches the finalized result', () => {
      const store = new ResultStore({ runId: 'run_20260101_000002', scenarioId: 's', projectRoot: tmpProjectRoot() });
      store.addStep({ step_id: 'step_1', status: 'fail', error_message: 'Login button not found' });
      const result = store.finalize({});
      expect(result.steps_executed[0].error_message).toBe('Login button not found');
    });

    test('run metadata overrides supplied to finalize reach the emitted result', () => {
      const store = new ResultStore({ runId: 'run_20260101_000003', scenarioId: 's', projectRoot: tmpProjectRoot() });
      store.addStep({ step_id: 'step_1', status: 'pass' });
      const result = store.finalize({
        metadata: { app_version: '1.2.3', device_model: 'Pixel 7', api_level: '34', environment: 'staging' },
      });
      expect(result.metadata).toMatchObject({
        app_version: '1.2.3',
        device_model: 'Pixel 7',
        api_level: '34',
        environment: 'staging',
      });
    });

    test('a supplied summary reaches the emitted result', () => {
      const store = new ResultStore({ runId: 'run_20260101_000004', scenarioId: 's', projectRoot: tmpProjectRoot() });
      store.addStep({ step_id: 'step_1', status: 'pass' });
      const result = store.finalize({ summary: 'Login flow verified end to end.' });
      expect(result.summary).toBe('Login flow verified end to end.');
    });

    test('omitting summary keeps the generated default', () => {
      const store = new ResultStore({ runId: 'run_20260101_000005', scenarioId: 's', projectRoot: tmpProjectRoot() });
      store.addStep({ step_id: 'step_1', status: 'pass' });
      const result = store.finalize({});
      expect(result.summary).toBe('passed: 0/0 assertion(s) passed across 1 step(s).');
    });
  });
});
