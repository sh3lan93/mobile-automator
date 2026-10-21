'use strict';

const { normalizeResult, diffNormalized } = require('../../../sample-app/scripts/lib/normalize-result');

function result(overrides = {}) {
  return {
    run_id: 'run_20261021_120000',
    scenario_id: 'golden_search_empty',
    schema_version: '2.0',
    status: 'passed',
    metadata: { app_version: 'debug', device_model: 'Pixel 9', api_level: '35', environment: 'ci', timestamp: '2026-10-21T12:00:00.000Z' },
    total_assertions: 2,
    passed_assertions: 2,
    failed_assertions: 0,
    duration_seconds: 41.2,
    steps_executed: [
      { step_id: 'launch', status: 'passed', screenshot: null, error_message: null, retried: false, retry_count: 0, step_duration_ms: 900, observations: null },
      { step_id: 'tap_more', status: 'passed', screenshot: 'mobile-automator/screenshots/x/run_20261021_120000/step_tap_more.png', error_message: null, retried: false, retry_count: 0, observations: null },
    ],
    assertion_results: [
      { assertion_id: 'no_results', status: 'passed', expected: 'No products match', actual: null, message: 'Found text.' },
      { assertion_id: 'bell', status: 'passed', expected: null, actual: null, message: 'present' },
    ],
    observations: [],
    captured_variables: {},
    measurements: { source: 'trace', trace_events: 12 },
    summary: 'passed: 2/2 assertion(s) passed across 2 step(s).',
    ...overrides,
  };
}

describe('normalizeResult', () => {
  test('keeps only the mechanical facts', () => {
    expect(normalizeResult(result())).toEqual({
      scenario_id: 'golden_search_empty',
      status: 'passed',
      total_assertions: 2,
      passed_assertions: 2,
      failed_assertions: 0,
      step_count: 2,
      steps_executed: [
        { step_id: 'launch', status: 'passed' },
        { step_id: 'tap_more', status: 'passed' },
      ],
      assertion_results: [
        { assertion_id: 'no_results', status: 'passed' },
        { assertion_id: 'bell', status: 'passed' },
      ],
    });
  });

  test('two runs differing only in run_id, timestamps, durations and device metadata normalize equal', () => {
    const b = result({
      run_id: 'run_20261022_090000',
      metadata: { app_version: '1.2', device_model: 'emulator-5554', api_level: '34', environment: 'local', timestamp: '2026-10-22T09:00:00.000Z' },
      duration_seconds: 12,
      measurements: undefined,
      summary: 'other',
    });
    b.steps_executed = b.steps_executed.map((s) => ({ ...s, step_duration_ms: 1, screenshot: 'elsewhere.png' }));
    b.assertion_results = b.assertion_results.map((a) => ({ ...a, message: 'different words' }));
    expect(normalizeResult(b)).toEqual(normalizeResult(result()));
    expect(diffNormalized(normalizeResult(result()), normalizeResult(b))).toEqual([]);
  });

  test('tolerates a result missing the optional arrays', () => {
    const n = normalizeResult({ scenario_id: 's', status: 'failed' });
    expect(n.steps_executed).toEqual([]);
    expect(n.assertion_results).toEqual([]);
    expect(n.step_count).toBe(0);
  });
});

describe('diffNormalized', () => {
  test('reports a changed step status with its path', () => {
    const a = normalizeResult(result());
    const changed = result();
    changed.steps_executed[1] = { ...changed.steps_executed[1], status: 'failed' };
    const lines = diffNormalized(a, normalizeResult(changed));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('steps_executed[1].status');
    expect(lines[0]).toContain('"passed"');
    expect(lines[0]).toContain('"failed"');
  });

  test('reports missing and unexpected entries', () => {
    const a = normalizeResult(result());
    const shorter = result();
    shorter.assertion_results = shorter.assertion_results.slice(0, 1);
    const lines = diffNormalized(a, normalizeResult(shorter));
    expect(lines.some((l) => l.includes('assertion_results[1]') && /missing/.test(l))).toBe(true);
    const back = diffNormalized(normalizeResult(shorter), a);
    expect(back.some((l) => l.includes('assertion_results[1]') && /unexpected/.test(l))).toBe(true);
  });
});
