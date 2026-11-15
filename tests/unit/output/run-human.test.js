'use strict';

// renderRunHuman: `mauto run --human` (replay R6, #282). A run envelope reads
// as a summary. Only handleRun's envelopes reach it (src/cli.js attaches it at
// the run call site); everything else takes the generic render there.

const { ok, fail } = require('../../../src/output/envelope');
const { renderRunHuman } = require('../../../src/output/run-human');

function data(over = {}) {
  return {
    run_id: 'run_20261115_120000',
    scenario_id: 'demo',
    status: 'passed',
    result_path: '.mobile-automator/results/run_20261115_120000.json',
    duration_seconds: 12.43,
    steps: { total: 2, passed: 2, failed: 0, error: 0, skipped: 0, needs_agent: 0 },
    assertions: { total: 1, passed: 1, failed: 0, needs_agent: 0 },
    failed_step: null,
    failures: [],
    pending: [],
    junit_path: null,
    executor: { kind: 'runner' },
    ...over,
  };
}

test('a passed run: the headline, the counts and the result; empty sections omitted', () => {
  expect(renderRunHuman(ok(data()))).toBe([
    'run run_20261115_120000 (demo): passed in 12.4s',
    'steps: 2 total, 2 passed, 0 failed, 0 error, 0 skipped, 0 needs agent',
    'assertions: 1 total, 1 passed, 0 failed, 0 needs agent',
    'result: .mobile-automator/results/run_20261115_120000.json',
  ].join('\n'));
});

test('a failed run: the error line first, then the failed step, failures, junit and hint', () => {
  const envelope = fail('test_failed', 'run run_20261115_120000 failed', 'See data.failures.', data({
    status: 'failed',
    steps: { total: 5, passed: 4, failed: 1, error: 0, skipped: 0, needs_agent: 0 },
    failed_step: 'tap_more',
    failures: ['step tap_more (tap): not found', 'assertion a1: nope'],
    junit_path: '/abs/report.xml',
  }));
  expect(renderRunHuman(envelope)).toBe([
    'error [test_failed]: run run_20261115_120000 failed',
    'run run_20261115_120000 (demo): failed in 12.4s',
    'steps: 5 total, 4 passed, 1 failed, 0 error, 0 skipped, 0 needs agent',
    'assertions: 1 total, 1 passed, 0 failed, 0 needs agent',
    'failed step: tap_more',
    'failures:',
    '  - step tap_more (tap): not found',
    '  - assertion a1: nope',
    'result: .mobile-automator/results/run_20261115_120000.json',
    'junit: /abs/report.xml',
    'hint: See data.failures.',
  ].join('\n'));
});

test('an incomplete run lists what is pending', () => {
  const envelope = fail('incomplete', 'run run_20261115_120000 incomplete: 2 assertion(s) need agent judgment', 'do this\nthen that', data({
    status: 'incomplete',
    assertions: { total: 3, passed: 1, failed: 0, needs_agent: 2 },
    pending: [
      { assertion_id: 'a2', step_id: 'step_x', type: 'visual_appearance' },
      { assertion_id: 'a3', step_id: null, type: null },
    ],
  }));
  const out = renderRunHuman(envelope);
  expect(out).toContain('assertions: 3 total, 1 passed, 0 failed, 2 needs agent');
  expect(out).toContain('pending:\n  - a2 (visual_appearance, after step_x)\n  - a3');
  expect(out.endsWith('hint: do this\nthen that')).toBe(true);
  expect(out).not.toContain('failures:');
});
