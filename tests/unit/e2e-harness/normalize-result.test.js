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
      { step_id: 'tap_more', status: 'passed', screenshot: '.mobile-automator/screenshots/x/run_20261021_120000/step_tap_more.png', error_message: null, retried: false, retry_count: 0, observations: null },
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

  // `mauto run` (#278) results carry assertion provenance and an executor
  // block. The deterministic part (type, mechanical, who judged) is a fact a
  // run must reproduce; the executor, judge version, screenshot paths and
  // similarity score are not.
  function runnerResult(overrides = {}) {
    return result({
      status: 'incomplete',
      executor: {
        kind: 'runner',
        mauto_version: '0.40.0-rc.8',
        device_id: 'emulator-5554',
        scenario_path: '/tmp/mauto-e2e-abc/.mobile-automator/scenarios/golden_search_empty.json',
      },
      steps_executed: [
        { step_id: 'launch', status: 'passed', screenshot: null, error_message: null, step_duration_ms: 900 },
        { step_id: 'judge_me', status: 'passed', needs_agent: true, screenshot: 'x.png', error_message: null },
      ],
      assertion_results: [
        {
          step_id: 'launch',
          assertion_id: 'no_results',
          type: 'element_text',
          status: 'passed',
          message: 'Found text.',
          expected: 'No products match',
          actual: 'No products match',
          mechanical: true,
          judge: { by: 'mechanical', name: 'evaluator', version: '0.40.0-rc.8' },
        },
        {
          step_id: 'judge_me',
          assertion_id: 'looks',
          type: 'screen_matches_reference',
          status: 'needs_agent',
          message: 'similarity 0.91',
          expected: null,
          actual: null,
          mechanical: false,
          judge: { by: 'agent', version: '1' },
          reference_screenshot: 'ref.png',
          actual_screenshot: '.mobile-automator/screenshots/a.png',
          similarity_score: 0.91,
        },
      ],
      ...overrides,
    });
  }

  test('keeps deterministic assertion provenance and drops executor, judge.version, screenshots and similarity', () => {
    const n = normalizeResult(runnerResult());
    expect(n.status).toBe('incomplete');
    expect(n).not.toHaveProperty('executor');
    expect(n.steps_executed).toEqual([
      { step_id: 'launch', status: 'passed' },
      { step_id: 'judge_me', status: 'passed', needs_agent: true },
    ]);
    expect(n.assertion_results).toEqual([
      {
        assertion_id: 'no_results',
        status: 'passed',
        step_id: 'launch',
        type: 'element_text',
        mechanical: true,
        judge: { by: 'mechanical', name: 'evaluator' },
      },
      {
        assertion_id: 'looks',
        status: 'needs_agent',
        step_id: 'judge_me',
        type: 'screen_matches_reference',
        mechanical: false,
        judge: { by: 'agent' },
      },
    ]);
    const text = JSON.stringify(n);
    for (const banned of ['executor', 'version', 'reference_screenshot', 'actual_screenshot', 'similarity_score', 'screenshot', 'message', 'duration']) {
      expect(text).not.toContain(banned);
    }
  });

  test('two runner results differing only in executor, judge.version, screenshots and similarity normalize equal', () => {
    const b = runnerResult({
      executor: { kind: 'runner', mauto_version: '0.41.0', device_id: 'R5CT', scenario_path: '/elsewhere/s.json' },
    });
    b.assertion_results = b.assertion_results.map((a) => ({
      ...a,
      message: 'other words',
      actual: 'other',
      judge: { ...a.judge, version: '9.9.9' },
      ...(a.reference_screenshot ? { reference_screenshot: 'r2.png', actual_screenshot: 'a2.png', similarity_score: 0.5 } : {}),
    }));
    b.steps_executed = b.steps_executed.map((s) => ({ ...s, screenshot: 'elsewhere.png', step_duration_ms: 3 }));
    expect(normalizeResult(b)).toEqual(normalizeResult(runnerResult()));
    expect(diffNormalized(normalizeResult(runnerResult()), normalizeResult(b))).toEqual([]);
  });

  test('a change in the deterministic provenance is a difference', () => {
    const b = runnerResult();
    b.assertion_results[0] = { ...b.assertion_results[0], judge: { by: 'agent' }, mechanical: false };
    const lines = diffNormalized(normalizeResult(runnerResult()), normalizeResult(b));
    expect(lines.some((l) => l.startsWith('assertion_results[0].mechanical'))).toBe(true);
    expect(lines.some((l) => l.startsWith('assertion_results[0].judge.by'))).toBe(true);
  });

  test('older results without provenance normalize to the old shape (optional keys omitted, not null)', () => {
    const n = normalizeResult(result());
    for (const a of n.assertion_results) expect(Object.keys(a).sort()).toEqual(['assertion_id', 'status']);
    for (const s of n.steps_executed) expect(Object.keys(s).sort()).toEqual(['status', 'step_id']);
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

  test('ignores top-level keys starting with "_" (fixture annotations like _provenance)', () => {
    const golden = { _provenance: 'generated on a Pixel 9 Pro AVD', ...normalizeResult(result()) };
    expect(diffNormalized(golden, normalizeResult(result()))).toEqual([]);
    expect(diffNormalized(normalizeResult(result()), { ...normalizeResult(result()), _note: 'x' })).toEqual([]);
  });

  test('"_" keys are ignored only at the top level', () => {
    const a = normalizeResult(result());
    const b = normalizeResult(result());
    b.steps_executed[0] = { ...b.steps_executed[0], _extra: 1 };
    expect(diffNormalized(a, b)).toEqual(['steps_executed[0]._extra: unexpected 1']);
  });

  test('the checked-in golden matches a passing run of its own steps', () => {
    const golden = require('../../../sample-app/scenarios/golden/golden_search_empty.result.json');
    const scenario = require('../../../sample-app/scenarios/golden_search_empty.json');
    expect(typeof golden._provenance).toBe('string');
    const run = {
      scenario_id: scenario.scenario_id,
      status: 'passed',
      total_assertions: scenario.assertions.length,
      passed_assertions: scenario.assertions.length,
      failed_assertions: 0,
      steps_executed: scenario.steps.map((s) => ({ step_id: s.id, status: 'passed' })),
      assertion_results: scenario.assertions.map((a) => ({ assertion_id: a.id, status: 'passed' })),
    };
    expect(diffNormalized(golden, normalizeResult(run))).toEqual([]);
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
