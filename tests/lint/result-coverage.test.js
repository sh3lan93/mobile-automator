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
const { OBSERVATION_TYPES, RUN_STATUSES, STEP_STATUS_ALIASES } = require('../../src/result/flags');
const { buildProgram, handleResultExport, handleResultFinalize } = require('../../src/cli');
const { ScenarioValidator } = require('../../src/scenario/validator');
const { workspaceDir } = require('../../src/workspace/layout');

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

// `result` subcommands that only READ result files, so they carry no fact into
// one and have no capability to claim their flags. Each names why. The tests
// below keep the exemption from becoming an escape hatch: an entry must name a
// registered subcommand, must not be the write verb of any capability, and
// must leave the results directory byte-for-byte unchanged when it runs.
const READ_ONLY_RESULT_VERBS = {
  export:
    'renders finalized result files as a CI report (--format, --out); it reads results/ and writes only the report, ' +
    'so no flag of it reaches a result file',
};

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
      if (Object.prototype.hasOwnProperty.call(READ_ONLY_RESULT_VERBS, sub.name())) continue;
      for (const flag of longFlags(sub)) {
        if (!IDENTITY_FLAGS.has(flag) && !claimed.has(flag)) {
          orphans.push(`${sub.name()} ${flag}`);
        }
      }
    }
    expect(orphans).toEqual([]);
  });

  describe('read-only exemptions stay honest', () => {
    const exempt = Object.entries(READ_ONLY_RESULT_VERBS);

    test.each(exempt)('%s carries a reason and names a registered result subcommand', (name, reason) => {
      expect(typeof reason).toBe('string');
      expect(reason.trim().length).toBeGreaterThan(0);
      expect(subcommand(name)).toBeDefined();
    });

    test('no exempt verb is the write verb of a capability', () => {
      const writers = new Set(capabilities.map(([, def]) => def.verb));
      expect(exempt.map(([name]) => name).filter((name) => writers.has(name))).toEqual([]);
    });

    test('export leaves the results directory byte-for-byte unchanged', () => {
      const root = tmpProjectRoot();
      const store = new ResultStore({ runId: 'run_20260101_000007', scenarioId: 's', projectRoot: root });
      store.addStep({ step_id: 'step_1', status: 'fail', error_message: 'boom' });
      store.addAssertion({ step_id: 'step_1', type: 'element_exists', pass: false, message: 'missing' });
      store.finalize({});
      const resultsDir = path.join(workspaceDir(root), 'results');
      const snapshot = () =>
        Object.fromEntries(fs.readdirSync(resultsDir).sort().map((f) => [f, fs.readFileSync(path.join(resultsDir, f), 'utf8')]));
      const before = snapshot();

      const r = handleResultExport({ projectRoot: root, cwd: root }, { runIds: ['run_20260101_000007'], format: 'junit' });
      expect(r.envelope.ok).toBe(true);
      expect(r.envelope.data.failures).toBe(2);
      expect(snapshot()).toEqual(before);
    });
  });

  test('OBSERVATION_TYPES matches the schema enum exactly', () => {
    const enumValues = resolvePointer('/properties/observations/items/properties/type/enum');
    expect([...OBSERVATION_TYPES].sort()).toEqual([...enumValues].sort());
  });

  // `result finalize --status` validates against this list, so it must be the
  // schema's enum — not a near copy of it (#286 review).
  test('RUN_STATUSES matches the schema run-status enum exactly', () => {
    const enumValues = resolvePointer('/properties/status/enum');
    expect([...RUN_STATUSES].sort()).toEqual([...enumValues].sort());
  });

  // The alias map's OUTPUTS are the schema's step-status enum: every accepted
  // spelling lands on a schema value, and every schema value is reachable — so
  // an alias can never record a value the schema forbids, and the enum can
  // never hide an unreachable value (#286 review).
  test('STEP_STATUS_ALIASES normalizes onto the schema step-status enum exactly', () => {
    const enumValues = resolvePointer('/properties/steps_executed/items/properties/status/enum');
    expect([...new Set(Object.values(STEP_STATUS_ALIASES))].sort()).toEqual([...enumValues].sort());
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

  test('the legacy step-level observations string is marked deprecated', () => {
    const legacy = resolvePointer('/properties/steps_executed/items/properties/observations');
    // Kept for backward compatibility with result files written before #140,
    // but the typed root array is the single source of truth — no new writer.
    expect(legacy.type).toEqual(['string', 'null']);
    expect(legacy.description).toMatch(/deprecated/i);
    expect(legacy.description).toMatch(/observations/);
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

    // `measurements` has no flag by design (see NO_FLAG_ALLOWLIST), so the
    // catalog cannot bind it to one. This is the #140 check in its place:
    // a home the store can actually fill.
    test('a supplied measurement reaches the finalized result', () => {
      const store = new ResultStore({ runId: 'run_20260101_000006', scenarioId: 's', projectRoot: tmpProjectRoot() });
      store.addStep({ step_id: 'step_1', status: 'pass' });
      const result = store.finalize({
        durationSeconds: 12.5,
        measurements: {
          source: 'trace',
          reported_duration_seconds: null,
          duration_disagreement: false,
          trace_events: 4,
          device_failures: 0,
          trace_truncated: false,
          failure_screenshots: [],
        },
      });
      expect(result.measurements.source).toBe('trace');
      expect(result.duration_seconds).toBe(12.5);
    });

    // #275: assertion provenance. type, step_id, mechanical and judge are
    // bare keys that also appear as parameter names in store.js.
    test('judge, type, step_id and mechanical supplied to addAssertion reach the finalized result', () => {
      const store = new ResultStore({ runId: 'run_20260101_000008', scenarioId: 's', projectRoot: tmpProjectRoot() });
      store.addAssertion({ step_id: 'step_1', assertion_id: 'a1', type: 'element_exists', pass: true, mechanical: true, judge: { by: 'agent' } });
      const [entry] = store.finalize({}).assertion_results;
      expect(entry).toMatchObject({ type: 'element_exists', step_id: 'step_1', mechanical: true, judge: { by: 'agent' } });
    });

    test('a pending verdict is replaced in place by the decided one, and the run passes', () => {
      const store = new ResultStore({ runId: 'run_20260101_000009', scenarioId: 's', projectRoot: tmpProjectRoot() });
      store.addAssertion({ step_id: 'step_1', assertion_id: 'a1', type: 'visual_state', status: 'needs_agent', judge: { by: 'none' } });
      store.addAssertion({ step_id: 'step_1', assertion_id: 'a2', type: 'element_exists', pass: true });
      store.addAssertion({ step_id: 'step_1', assertion_id: 'a1', type: 'visual_state', pass: true, judge: { by: 'agent' } });
      const result = store.finalize({});
      expect(result.assertion_results.map((a) => [a.assertion_id, a.status])).toEqual([['a1', 'passed'], ['a2', 'passed']]);
      expect(result.status).toBe('passed');
    });

    test('a pending verdict finalizes the run incomplete', () => {
      const store = new ResultStore({ runId: 'run_20260101_000010', scenarioId: 's', projectRoot: tmpProjectRoot() });
      store.addAssertion({ step_id: 'step_1', assertion_id: 'a1', type: 'visual_state', status: 'needs_agent' });
      const result = store.finalize({});
      expect(result.status).toBe('incomplete');
      expect(result.assertion_results[0].status).toBe('needs_agent');
    });

    test('--scenario on finalize reaches the executor in the result file', () => {
      const root = tmpProjectRoot();
      const runId = 'run_20260101_000011';
      const scenarioPath = path.join(root, 's.json');
      fs.writeFileSync(scenarioPath, JSON.stringify({
        $schema_version: '2.1', scenario_id: 's', name: 'n', description: 'd', platform: 'cross-platform',
        app_package: 'com.example.app', metadata: { app_version: '1', environment: 'staging' },
        steps: [{ id: 'step_1', action: 'launch_app', description: 'Launch' }], assertions: [],
      }));
      new ResultStore({ runId, scenarioId: 's', projectRoot: root }).addStep({ step_id: 'step_1', status: 'pass' });
      const r = handleResultFinalize(
        { resultStoreFactory: (o) => new ResultStore(o), projectRoot: root, validator: new ScenarioValidator() },
        { runId, scenario: scenarioPath }
      );
      expect(r.exitKind).toBe('ok');
      const saved = JSON.parse(fs.readFileSync(path.join(workspaceDir(root), 'results', `${runId}.json`), 'utf8'));
      expect(saved.executor).toMatchObject({ kind: 'agent', scenario_path: path.relative(root, scenarioPath) });
      expect(saved.executor.scenario_sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    test('a crash supplied to addCrash reaches the finalized result', () => {
      const store = new ResultStore({ runId: 'run_20260101_000006', scenarioId: 's', projectRoot: tmpProjectRoot() });
      store.addStep({ step_id: 'step_1', status: 'fail' });
      store.addCrash({ crash_id: 'r1', process: 'com.acme.app', step_id: 'step_1' });
      const result = store.finalize({});
      expect(result.crashes[0].crash_id).toBe('r1');
      expect(result.crashes[0].process).toBe('com.acme.app');
    });
  });
});
