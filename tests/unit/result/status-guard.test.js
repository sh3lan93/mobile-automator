'use strict';

const { resolveRunStatus, StatusRefusedError } = require('../../../src/result/status-guard');
const { ResultStoreRefusal } = require('../../../src/result/refusal');

const step = (status, extra = {}) => ({ step_id: 's', status, ...extra });
const assertion = (status) => ({ assertion_id: 'a', status });

// The refusal resolveRunStatus throws, as `{message, hint}`; null when the
// status is written.
function refusal(args) {
  try {
    resolveRunStatus(args);
    return null;
  } catch (err) {
    if (!(err instanceof StatusRefusedError)) throw err;
    return { message: err.message, hint: err.hint };
  }
}

describe('resolveRunStatus: the status written', () => {
  test('with no explicit status, the derived one', () => {
    expect(resolveRunStatus({ steps: [], assertions: [] })).toBe('passed');
    expect(resolveRunStatus({ steps: [step('failed')], assertions: [] })).toBe('failed');
    expect(resolveRunStatus({ steps: [step('pass')], assertions: [assertion('needs_agent')] })).toBe('incomplete');
  });

  test('an allowed explicit status is written as given', () => {
    expect(resolveRunStatus({ status: 'error', steps: [step('failed')], assertions: [] })).toBe('error');
    expect(resolveRunStatus({ status: 'passed', steps: [step('pass')], assertions: [assertion('passed')] })).toBe('passed');
  });

  test('a refusal is a StatusRefusedError: a ResultStoreRefusal of kind invalid_input', () => {
    let err;
    try {
      resolveRunStatus({ status: 'passed', steps: [step('failed')], assertions: [] });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(StatusRefusedError);
    expect(err).toBeInstanceOf(ResultStoreRefusal);
    expect(err.name).toBe('StatusRefusedError');
    expect(err.kind).toBe('invalid_input');
    expect(err.message).toBe('cannot finalize --status passed: the recorded steps and assertions derive "failed"');
  });
});

describe('an explicit status may equal the derived one or be worse, never greener', () => {
  test('passed over a pending assertion is refused and names the derived status', () => {
    const r = refusal({ status: 'passed', steps: [step('pass')], assertions: [assertion('needs_agent')] });
    expect(r.message).toMatch(/incomplete/);
    expect(r.hint).toMatch(/incomplete/);
  });

  test('passed over a failed step is refused', () => {
    expect(refusal({ status: 'passed', steps: [step('failed')], assertions: [] }).message).toMatch(/failed/);
  });

  test('passed over an errored step is refused', () => {
    expect(refusal({ status: 'passed', steps: [step('error')], assertions: [] }).message).toMatch(/error/);
  });

  test('passed over an empty run is refused', () => {
    expect(refusal({ status: 'passed', steps: [], assertions: [] }).message).toMatch(/nothing recorded/i);
  });

  test('passed over an empty run is allowed when the scenario declares no steps or assertions', () => {
    expect(refusal({ status: 'passed', steps: [], assertions: [], scenario: { steps: [], assertions: [] } })).toBeNull();
    expect(refusal({ status: 'passed', steps: [], assertions: [], scenario: { steps: [] } })).toBeNull();
  });

  test('passed over an empty run is refused when the scenario declares assertions', () => {
    const scenario = { steps: [], assertions: [{ id: 'x', after_step: 's', type: 'element_exists' }] };
    expect(refusal({ status: 'passed', steps: [], assertions: [], scenario })).not.toBeNull();
  });

  test('passed over a clean recorded run is allowed', () => {
    expect(refusal({ status: 'passed', steps: [step('pass')], assertions: [assertion('passed')] })).toBeNull();
  });

  test('failed and error may make any run worse', () => {
    for (const status of ['failed', 'error']) {
      expect(refusal({ status, steps: [], assertions: [] })).toBeNull();
      expect(refusal({ status, steps: [step('pass')], assertions: [assertion('passed')] })).toBeNull();
      expect(refusal({ status, steps: [step('pass')], assertions: [assertion('needs_agent')] })).toBeNull();
    }
    expect(refusal({ status: 'error', steps: [step('failed')], assertions: [] })).toBeNull();
  });

  test('failed over a derived error is refused (less severe)', () => {
    expect(refusal({ status: 'failed', steps: [step('error')], assertions: [] })).not.toBeNull();
  });

  test('incomplete is allowed only when something is pending', () => {
    expect(refusal({ status: 'incomplete', steps: [step('pass')], assertions: [assertion('passed')] })).not.toBeNull();
    expect(refusal({ status: 'incomplete', steps: [], assertions: [] })).not.toBeNull();
    expect(refusal({ status: 'incomplete', steps: [step('pass')], assertions: [assertion('needs_agent')] })).toBeNull();
  });

  test('incomplete over a failing run is refused (less severe)', () => {
    expect(refusal({ status: 'incomplete', steps: [step('failed')], assertions: [assertion('needs_agent')] })).not.toBeNull();
  });
});

// #335: with a scenario, a declared step or assertion the run never recorded
// keeps a recorded-green run from being passed.
describe('an explicit status over unrecorded scenario entries (#335)', () => {
  const clean = { steps: [step('pass')], assertions: [assertion('passed')] };
  const recordedA = { id: 'a', after_step: 's', type: 'element_exists' };
  const shown = { id: 'shown', after_step: 'tap', type: 'element_exists' };
  const scenarioWith = ({ steps = ['s'], assertions = [recordedA] } = {}) => ({
    steps: steps.map((id) => ({ id, action: 'tap' })),
    assertions,
  });
  const gaps = scenarioWith({ steps: ['s', 'tap'], assertions: [recordedA, shown] });
  const none = scenarioWith();

  test('passed over a recorded-green run with gaps is refused, naming them', () => {
    const r = refusal({ status: 'passed', ...clean, scenario: gaps });
    expect(r.message).toBe(
      'cannot finalize --status passed: the scenario declares entries this run never recorded: steps tap; assertions shown'
    );
    expect(r.hint).toMatch(/incomplete/);
  });

  test('incomplete over a recorded-green run with gaps is allowed, and derived without --status', () => {
    expect(refusal({ status: 'incomplete', ...clean, scenario: gaps })).toBeNull();
    expect(resolveRunStatus({ ...clean, scenario: gaps })).toBe('incomplete');
  });

  test('failed and error stay allowed over gaps', () => {
    expect(refusal({ status: 'failed', ...clean, scenario: gaps })).toBeNull();
    expect(refusal({ status: 'error', ...clean, scenario: gaps })).toBeNull();
  });

  test('a scenario with nothing unrecorded changes nothing', () => {
    expect(refusal({ status: 'passed', ...clean, scenario: none })).toBeNull();
    expect(refusal({ status: 'incomplete', ...clean, scenario: none })).not.toBeNull();
  });

  test('only steps, or only assertions, missing is enough', () => {
    expect(refusal({ status: 'passed', ...clean, scenario: scenarioWith({ steps: ['s', 'tap'] }) })).not.toBeNull();
    expect(refusal({ status: 'passed', ...clean, scenario: scenarioWith({ assertions: [recordedA, shown] }) })).not.toBeNull();
  });

  test('gaps do not lift a derived failed run: incomplete is still refused there', () => {
    expect(refusal({ status: 'incomplete', steps: [step('failed')], assertions: [], scenario: gaps })).not.toBeNull();
  });
});
