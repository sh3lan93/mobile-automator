'use strict';

// loadScenario and finalizeRun are the halves of `validate` and
// `result finalize` that `mauto run` shares (#278). The handlers' own tests
// in tests/unit/cli.test.js pin the envelopes; these pin the helpers' shape.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { finalizeRun } = require('../../../src/cli');
const { loadScenario } = require('../../../src/scenario/load');
const { ScenarioValidator } = require('../../../src/scenario/validator');
const { ResultStore } = require('../../../src/result/store');

const validator = new ScenarioValidator({
  schemaPath: path.resolve(__dirname, '../../../src/schemas/scenario_schema.json'),
});

function scenario(extraSteps = []) {
  return {
    $schema_version: '2.1',
    scenario_id: 'login_smoke',
    name: 'Login smoke',
    description: 'Verifies the user can reach the login screen.',
    platform: 'cross-platform',
    app_package: 'com.example.app',
    metadata: { app_version: 'staging-latest', environment: 'staging' },
    steps: [{ id: 'launch', action: 'launch_app', description: 'Launch the app' }, ...extraSteps],
    assertions: [],
  };
}
const WIPE = { id: 'wipe', action: 'clear_app_data', target_package: 'com.example.app', description: 'Clear' };

function writeTmp(contents) {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-load-')), 's.json');
  fs.writeFileSync(p, contents);
  return p;
}

describe('loadScenario', () => {
  test('a clean scenario -> the parsed scenario, no warnings, no hint', () => {
    const r = loadScenario(validator, writeTmp(JSON.stringify(scenario())));
    expect(r.failure).toBeUndefined();
    expect(r.scenario.scenario_id).toBe('login_smoke');
    expect(r.warnings).toEqual([]);
    expect(r.hint).toBeNull();
  });

  test('a replay warning is returned with its hint when not strict', () => {
    const r = loadScenario(validator, writeTmp(JSON.stringify(scenario([WIPE]))));
    expect(r.failure).toBeUndefined();
    expect(r.warnings.map((w) => w.code)).toContain('unsupported_action');
    expect(typeof r.hint).toBe('string');
  });

  test('strict + a blocking finding -> invalid_input failure', () => {
    const r = loadScenario(validator, writeTmp(JSON.stringify(scenario([WIPE]))), { strict: true });
    expect(r.scenario).toBeUndefined();
    expect(r.failure.exitKind).toBe('invalid_input');
    expect(r.failure.envelope.data.valid).toBe(false);
  });

  test('unreadable file, bad JSON and schema-invalid are invalid_input failures', () => {
    for (const file of [
      path.join(os.tmpdir(), 'mauto-definitely-missing', 'x.json'),
      writeTmp('{ nope'),
      writeTmp(JSON.stringify({ scenario_id: 'x' })),
    ]) {
      const r = loadScenario(validator, file);
      expect(r.failure.exitKind).toBe('invalid_input');
      expect(r.failure.envelope.ok).toBe(false);
    }
  });
});

describe('finalizeRun', () => {
  function deps(memoryStoreFactory) {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-fin-'));
    const resultStoreFactory = (o) => new ResultStore(o);
    return { resultStoreFactory, memoryStoreFactory, projectRoot };
  }

  test('finalizes the run and returns the result, store and hints', () => {
    const d = deps();
    const runId = 'run_20261110_120000';
    d.resultStoreFactory({ runId, scenarioId: 'login_smoke', projectRoot: d.projectRoot })
      .addStep({ step_id: 'launch', status: 'pass' });
    const { result, store, hints } = finalizeRun(d, { runId, scenarioId: 'login_smoke', metadata: {} });
    expect(result.run_id).toBe(runId);
    expect(result.status).toBe('passed');
    expect(fs.existsSync(store.file)).toBe(true);
    expect(hints).toEqual([]);
  });

  test('records the run into memory and folds a memory failure into hints', () => {
    const recorded = [];
    const ok = deps(() => ({ recordRun: (r) => recorded.push(r.run_id), warnings: [] }));
    finalizeRun(ok, { runId: 'run_a', scenarioId: 's', status: 'passed', metadata: {} });
    expect(recorded).toEqual(['run_a']);

    const broken = deps(() => ({ recordRun: () => { throw new Error('disk full'); }, warnings: ['mem warn'] }));
    const { hints } = finalizeRun(broken, { runId: 'run_b', scenarioId: 's', status: 'passed', metadata: {} });
    expect(hints).toEqual(['run-history not updated: disk full', 'mem warn']);
  });
});
