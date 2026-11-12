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
