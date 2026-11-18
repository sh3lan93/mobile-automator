'use strict';

const { checkExplicitStatus } = require('../../../src/result/status-guard');

const step = (status, extra = {}) => ({ step_id: 's', status, ...extra });
const assertion = (status) => ({ assertion_id: 'a', status });

describe('checkExplicitStatus: an explicit status may equal the derived one or be worse, never greener', () => {
  test('nothing explicit is always fine', () => {
    expect(checkExplicitStatus({ status: undefined, steps: [], assertions: [] })).toBeNull();
  });

  test('passed over a pending assertion is refused and names the derived status', () => {
    const r = checkExplicitStatus({ status: 'passed', steps: [step('pass')], assertions: [assertion('needs_agent')] });
    expect(r.message).toMatch(/incomplete/);
    expect(r.hint).toMatch(/incomplete/);
  });

  test('passed over a failed step is refused', () => {
    const r = checkExplicitStatus({ status: 'passed', steps: [step('failed')], assertions: [] });
    expect(r.message).toMatch(/failed/);
  });

  test('passed over an errored step is refused', () => {
    expect(checkExplicitStatus({ status: 'passed', steps: [step('error')], assertions: [] }).message).toMatch(/error/);
  });

  test('passed over an empty run is refused', () => {
    const r = checkExplicitStatus({ status: 'passed', steps: [], assertions: [] });
    expect(r.message).toMatch(/nothing recorded/i);
  });

  test('passed over an empty run is allowed when the scenario declares zero assertions', () => {
    expect(checkExplicitStatus({ status: 'passed', steps: [], assertions: [], scenarioAssertionCount: 0 })).toBeNull();
  });

  test('passed over an empty run is refused when the scenario declares assertions', () => {
    expect(checkExplicitStatus({ status: 'passed', steps: [], assertions: [], scenarioAssertionCount: 2 })).not.toBeNull();
  });

  test('passed over a clean recorded run is allowed', () => {
    expect(checkExplicitStatus({ status: 'passed', steps: [step('pass')], assertions: [assertion('passed')] })).toBeNull();
  });

  test('failed and error may make any run worse', () => {
    for (const status of ['failed', 'error']) {
      expect(checkExplicitStatus({ status, steps: [], assertions: [] })).toBeNull();
      expect(checkExplicitStatus({ status, steps: [step('pass')], assertions: [assertion('passed')] })).toBeNull();
      expect(checkExplicitStatus({ status, steps: [step('pass')], assertions: [assertion('needs_agent')] })).toBeNull();
    }
    expect(checkExplicitStatus({ status: 'error', steps: [step('failed')], assertions: [] })).toBeNull();
  });

  test('failed over a derived error is refused (less severe)', () => {
    expect(checkExplicitStatus({ status: 'failed', steps: [step('error')], assertions: [] })).not.toBeNull();
  });

  test('incomplete is allowed only when something is pending', () => {
    expect(checkExplicitStatus({ status: 'incomplete', steps: [step('pass')], assertions: [assertion('passed')] })).not.toBeNull();
    expect(checkExplicitStatus({ status: 'incomplete', steps: [], assertions: [] })).not.toBeNull();
    expect(checkExplicitStatus({ status: 'incomplete', steps: [step('pass')], assertions: [assertion('needs_agent')] })).toBeNull();
  });

  test('incomplete over a failing run is refused (less severe)', () => {
    expect(checkExplicitStatus({ status: 'incomplete', steps: [step('failed')], assertions: [assertion('needs_agent')] })).not.toBeNull();
  });
});

// #335: with --scenario, a declared step or assertion the run never recorded
// keeps a recorded-green run from being passed.
describe('checkExplicitStatus with unrecorded scenario entries (#335)', () => {
  const clean = { steps: [step('pass')], assertions: [assertion('passed')] };
  const shown = { assertion_id: 'shown', step_id: 'tap', type: 'element_exists' };
  const gaps = { steps: ['tap'], assertions: [shown] };
  const none = { steps: [], assertions: [] };

  test('passed over a recorded-green run with gaps is refused, naming them', () => {
    const r = checkExplicitStatus({ status: 'passed', ...clean, unrecorded: gaps });
    expect(r.message).toBe(
      'cannot finalize --status passed: the scenario declares entries this run never recorded: steps tap; assertions shown'
    );
    expect(r.hint).toMatch(/incomplete/);
  });

  test('incomplete over a recorded-green run with gaps is allowed', () => {
    expect(checkExplicitStatus({ status: 'incomplete', ...clean, unrecorded: gaps })).toBeNull();
  });

  test('failed and error stay allowed over gaps', () => {
    expect(checkExplicitStatus({ status: 'failed', ...clean, unrecorded: gaps })).toBeNull();
    expect(checkExplicitStatus({ status: 'error', ...clean, unrecorded: gaps })).toBeNull();
  });

  test('empty gap lists change nothing', () => {
    expect(checkExplicitStatus({ status: 'passed', ...clean, unrecorded: none })).toBeNull();
    expect(checkExplicitStatus({ status: 'incomplete', ...clean, unrecorded: none })).not.toBeNull();
  });

  test('only steps, or only assertions, missing is enough', () => {
    expect(checkExplicitStatus({ status: 'passed', ...clean, unrecorded: { steps: ['tap'], assertions: [] } })).not.toBeNull();
    expect(checkExplicitStatus({ status: 'passed', ...clean, unrecorded: { steps: [], assertions: [shown] } })).not.toBeNull();
  });

  test('gaps do not lift a derived failed run: incomplete is still refused there', () => {
    expect(checkExplicitStatus({ status: 'incomplete', steps: [step('failed')], assertions: [], unrecorded: gaps })).not.toBeNull();
  });
});
