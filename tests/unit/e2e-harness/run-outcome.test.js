'use strict';

const { outcomeOf } = require('../../../sample-app/scripts/lib/run-outcome');

const step = (step_id, status, extra = {}) => ({ step_id, status, error_message: null, ...extra });
const assertion = (assertion_id, status, message = null) => ({ assertion_id, status, message });

describe('outcomeOf', () => {
  test('a passed run passes with no failed step and no details', () => {
    const r = outcomeOf({
      status: 'passed',
      steps_executed: [step('launch', 'passed'), step('tap', 'passed')],
      assertion_results: [assertion('a1', 'passed', 'ok')],
    });
    expect(r).toEqual({ passed: true, failedStep: null, details: [] });
  });

  test('the first failing step (failed or error) is the failed step, each with its message', () => {
    const r = outcomeOf({
      status: 'error',
      steps_executed: [
        step('launch', 'passed'),
        step('open', 'error', { error_message: 'device gone' }),
        step('tap', 'failed', { error_message: 'no element "Buy"' }),
      ],
      assertion_results: [],
    });
    expect(r.passed).toBe(false);
    expect(r.failedStep).toBe('open');
    expect(r.details).toEqual(['open: device gone', 'tap: no element "Buy"']);
  });

  test('a failed assertion fails the run without naming a failed step', () => {
    const r = outcomeOf({
      status: 'failed',
      steps_executed: [step('launch', 'passed')],
      assertion_results: [assertion('a1', 'passed'), assertion('no_results', 'failed', 'text "x" not found')],
    });
    expect(r).toEqual({ passed: false, failedStep: null, details: ['no_results: text "x" not found'] });
  });

  test('an incomplete run is not a pass, and names each needs_agent assertion', () => {
    const r = outcomeOf({
      status: 'incomplete',
      steps_executed: [step('launch', 'passed')],
      assertion_results: [assertion('looks_right', 'needs_agent', 'judge it')],
    });
    expect(r.passed).toBe(false);
    expect(r.failedStep).toBeNull();
    expect(r.details).toEqual(['looks_right: needs an agent (not judged)']);
  });

  test('a failing step with no message still gets a line', () => {
    const r = outcomeOf({ status: 'failed', steps_executed: [step('tap', 'failed')] });
    expect(r.failedStep).toBe('tap');
    expect(r.details).toHaveLength(1);
    expect(r.details[0]).toMatch(/^tap: /);
  });

  test('tolerates missing arrays and malformed entries', () => {
    expect(outcomeOf({ status: 'failed' })).toEqual({ passed: false, failedStep: null, details: [] });
    expect(outcomeOf(null)).toEqual({ passed: false, failedStep: null, details: [] });
    const r = outcomeOf({
      status: 'failed',
      steps_executed: [null, 'x', 42, step('tap', 'failed', { error_message: 'boom' })],
      assertion_results: 'nope',
    });
    expect(r).toEqual({ passed: false, failedStep: 'tap', details: ['tap: boom'] });
  });
});
