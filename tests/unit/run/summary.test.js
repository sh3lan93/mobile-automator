'use strict';

// runData: the frozen `data` shape of `mauto run`'s envelope (replay R6,
// #282). The keys, their order, and the step/assertion counts — each a
// partition, so the buckets sum to the total.

const path = require('path');

const { runData, RUN_DATA_KEYS } = require('../../../src/run/summary');

const ROOT = path.join(path.sep, 'tmp', 'proj');

const KEYS = [
  'run_id', 'scenario_id', 'status', 'result_path', 'duration_seconds', 'steps', 'assertions',
  'failed_step', 'failures', 'pending', 'junit_path', 'executor',
];

function result(over = {}) {
  return {
    run_id: 'run_20261115_120000',
    scenario_id: 'demo',
    status: 'failed',
    duration_seconds: 12.4,
    executor: { kind: 'runner' },
    measurements: { source: 'trace' },
    steps_executed: [
      { step_id: 's1', status: 'passed' },
      { step_id: 's2', status: 'failed' },
      { step_id: 's3', status: 'error' },
      { step_id: 's4', status: 'skipped' },
      { step_id: 's5', status: 'skipped', needs_agent: true },
      { step_id: 's6', status: 'passed' },
    ],
    assertion_results: [
      { assertion_id: 'a1', status: 'passed' },
      { assertion_id: 'a2', status: 'failed' },
      { assertion_id: 'a3', status: 'needs_agent', step_id: 's1', type: 'visual_state' },
    ],
    ...over,
  };
}

const build = (r = result(), extra = {}) => runData(r, {
  projectRoot: ROOT,
  resultFile: path.join(ROOT, '.mobile-automator', 'results', 'run_20261115_120000.json'),
  failedStep: 's2',
  failures: ['step s2 (tap): not found'],
  ...extra,
});

test('the keys are exactly the frozen set, in order', () => {
  expect(RUN_DATA_KEYS).toEqual(KEYS);
  expect(Object.keys(build())).toEqual(KEYS);
});

test('measurements is not part of the envelope data', () => {
  expect(build()).not.toHaveProperty('measurements');
});

test('carries the run facts, the result path relative to the root, and junit_path null by default', () => {
  expect(build()).toMatchObject({
    run_id: 'run_20261115_120000',
    scenario_id: 'demo',
    status: 'failed',
    result_path: path.join('.mobile-automator', 'results', 'run_20261115_120000.json'),
    duration_seconds: 12.4,
    failed_step: 's2',
    failures: ['step s2 (tap): not found'],
    pending: [{ assertion_id: 'a3', step_id: 's1', type: 'visual_state' }],
    junit_path: null,
    executor: { kind: 'runner' },
  });
});

test('junit_path is the path given', () => {
  expect(build(result(), { junitPath: '/abs/report.xml' }).junit_path).toBe('/abs/report.xml');
});

test('steps partition steps_executed; a needs_agent step counts only under needs_agent', () => {
  const { steps } = build();
  expect(steps).toEqual({ total: 6, passed: 2, failed: 1, error: 1, skipped: 1, needs_agent: 1 });
  expect(steps.passed + steps.failed + steps.error + steps.skipped + steps.needs_agent).toBe(steps.total);
});

test('assertions partition assertion_results', () => {
  const { assertions } = build();
  expect(assertions).toEqual({ total: 3, passed: 1, failed: 1, needs_agent: 1 });
  expect(assertions.passed + assertions.failed + assertions.needs_agent).toBe(assertions.total);
});

test('an empty run counts zero everywhere, and defaults the absent fields', () => {
  const d = build(result({ steps_executed: undefined, assertion_results: undefined, duration_seconds: undefined }), {
    failedStep: undefined,
    failures: undefined,
  });
  expect(d.steps).toEqual({ total: 0, passed: 0, failed: 0, error: 0, skipped: 0, needs_agent: 0 });
  expect(d.assertions).toEqual({ total: 0, passed: 0, failed: 0, needs_agent: 0 });
  expect(d.duration_seconds).toBe(0);
  expect(d.failed_step).toBeNull();
  expect(d.failures).toEqual([]);
});

// Fail closed: a CI job reads these counts, so a status this code does not
// recognise must never be counted as passed.
test('an unrecognised step status counts as error, and the partition still sums', () => {
  const { steps } = build(result({
    steps_executed: [
      { step_id: 's1', status: 'passed' },
      { step_id: 's2', status: 'weird' },
      { step_id: 's3' },
      null,
    ],
  }));
  expect(steps).toEqual({ total: 4, passed: 1, failed: 0, error: 3, skipped: 0, needs_agent: 0 });
  expect(steps.passed + steps.failed + steps.error + steps.skipped + steps.needs_agent).toBe(steps.total);
});

test('an unrecognised assertion status counts as failed, and the partition still sums', () => {
  const { assertions } = build(result({
    assertion_results: [
      { assertion_id: 'a1', status: 'passed' },
      { assertion_id: 'a2', status: 'weird' },
      { assertion_id: 'a3' },
    ],
  }));
  expect(assertions).toEqual({ total: 3, passed: 1, failed: 2, needs_agent: 0 });
  expect(assertions.passed + assertions.failed + assertions.needs_agent).toBe(assertions.total);
});
