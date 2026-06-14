'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const { ResultStore } = require('../../../src/result/store');

const RESULT_SCHEMA_PATH = path.resolve(
  __dirname,
  '../../../templates/mobile-automator-executor/references/result_schema.json'
);

function ajvValidator() {
  const schema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  return ajv.compile(schema);
}

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-store-'));
}

const RUN_ID = 'run_20260614_101500';

describe('ResultStore', () => {
  test('finalize assembles a result that conforms to result_schema.json', () => {
    const projectRoot = tmpRoot();
    const store = new ResultStore({ runId: RUN_ID, scenarioId: 'login_smoke', projectRoot });

    store.addStep({ step_id: 'launch', status: 'pass' });
    store.addStep({ step_id: 'tap_login', status: 'pass' });
    store.addAssertion({ step_id: 'launch', type: 'element_exists', pass: true, message: 'Login present' });
    store.addAssertion({ step_id: 'tap_login', type: 'element_text', pass: false, message: 'wrong text' });

    const result = store.finalize({ status: 'failed', durationSeconds: 12.5 });

    const validate = ajvValidator();
    const valid = validate(result);
    if (!valid) {
      // surface schema errors for debugging
      // eslint-disable-next-line no-console
      console.error(validate.errors);
    }
    expect(valid).toBe(true);

    expect(result.run_id).toBe(RUN_ID);
    expect(result.scenario_id).toBe('login_smoke');
    expect(result.status).toBe('failed');
    expect(result.duration_seconds).toBe(12.5);
    expect(result.steps_executed).toHaveLength(2);
  });

  test('maintains passed/failed/total assertion counts', () => {
    const store = new ResultStore({ runId: RUN_ID, scenarioId: 's', projectRoot: tmpRoot() });
    store.addAssertion({ step_id: 'a', type: 'element_exists', pass: true, message: 'ok' });
    store.addAssertion({ step_id: 'b', type: 'element_exists', pass: true, message: 'ok' });
    store.addAssertion({ step_id: 'c', type: 'element_exists', pass: false, message: 'no' });

    const result = store.finalize();
    expect(result.total_assertions).toBe(3);
    expect(result.passed_assertions).toBe(2);
    expect(result.failed_assertions).toBe(1);
  });

  test('records a flakiness observation when a passing step took more than one attempt', () => {
    const store = new ResultStore({ runId: RUN_ID, scenarioId: 's', projectRoot: tmpRoot() });
    store.addStep({ step_id: 'flaky_tap', status: 'pass', attempts: 3 });
    store.addStep({ step_id: 'steady', status: 'pass', attempts: 1 });

    const result = store.finalize();
    const flaky = result.observations.filter((o) => o.type === 'flakiness');
    expect(flaky).toHaveLength(1);
    expect(flaky[0].step_id).toBe('flaky_tap');
    expect(flaky[0].message).toMatch(/3/);
  });

  test('does not record flakiness for a step that ultimately failed even with retries', () => {
    const store = new ResultStore({ runId: RUN_ID, scenarioId: 's', projectRoot: tmpRoot() });
    store.addStep({ step_id: 'bad', status: 'fail', attempts: 4 });
    const result = store.finalize();
    expect(result.observations.filter((o) => o.type === 'flakiness')).toHaveLength(0);
  });

  test('writes the finalized result to <projectRoot>/mobile-automator/results/<runId>.json', () => {
    const projectRoot = tmpRoot();
    const store = new ResultStore({ runId: RUN_ID, scenarioId: 's', projectRoot });
    store.addStep({ step_id: 'launch', status: 'pass' });
    store.finalize({ status: 'passed' });

    const file = path.join(projectRoot, 'mobile-automator', 'results', `${RUN_ID}.json`);
    expect(fs.existsSync(file)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(onDisk.run_id).toBe(RUN_ID);
  });

  test('reloads an in-progress file across separate instances (incremental updates)', () => {
    const projectRoot = tmpRoot();

    const a = new ResultStore({ runId: RUN_ID, scenarioId: 's', projectRoot });
    a.addStep({ step_id: 'launch', status: 'pass' });

    // A fresh process / instance picks up where the first left off.
    const b = new ResultStore({ runId: RUN_ID, scenarioId: 's', projectRoot });
    b.addStep({ step_id: 'tap', status: 'pass' });

    const result = b.finalize({ status: 'passed' });
    expect(result.steps_executed.map((s) => s.step_id)).toEqual(['launch', 'tap']);
  });
});
