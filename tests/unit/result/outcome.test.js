'use strict';

const {
  isFailedStep,
  isErroredStep,
  isFailingStep,
  isFailingAssertion,
  isPendingAssertion,
  isPendingStep,
  deriveRunStatus,
} = require('../../../src/result/outcome');
const { toJUnit } = require('../../../src/result/junit');
const { parseXml, findAll } = require('../../helpers/parse-xml');

const step = (status) => ({ step_id: 's', status });
const assertion = (status) => ({ assertion_id: 'a', step_id: 's', status });

describe('outcome predicates (#296)', () => {
  test.each([
    ['failed', true, false, true],
    ['error', false, true, true],
    ['passed', false, false, false],
    ['skipped', false, false, false],
    [undefined, false, false, false],
  ])('a %s step: failed=%s errored=%s failing=%s', (status, failed, errored, failing) => {
    expect(isFailedStep(step(status))).toBe(failed);
    expect(isErroredStep(step(status))).toBe(errored);
    expect(isFailingStep(step(status))).toBe(failing);
  });

  test.each([
    ['failed', true],
    ['passed', false],
    [undefined, false],
  ])('a %s assertion: failing=%s', (status, failing) => {
    expect(isFailingAssertion(assertion(status))).toBe(failing);
  });

  // junit tolerates malformed result files; the predicates it shares must too.
  test.each([null, undefined, 'x', 7, []])('%p is never failing and never throws', (odd) => {
    expect(isFailedStep(odd)).toBe(false);
    expect(isErroredStep(odd)).toBe(false);
    expect(isFailingStep(odd)).toBe(false);
    expect(isFailingAssertion(odd)).toBe(false);
  });
});

const CASES = [
  ['no steps, no assertions', 'passed', [], []],
  ['a failed step', 'failed', [step('failed')], []],
  ['an errored step', 'error', [step('error')], []],
  ['an errored step beats a failed assertion', 'error', [step('error')], [assertion('failed')]],
  ['an errored step beats a failed step', 'error', [step('failed'), step('error')], []],
  ['a failed assertion with passed steps', 'failed', [step('passed')], [assertion('failed')]],
  ['all passed', 'passed', [step('passed')], [assertion('passed')]],
  ['skipped steps do not count', 'passed', [step('skipped'), step('passed')], []],
  ['all skipped', 'passed', [step('skipped')], []],
  ['a step failed then passed on retry', 'failed', [step('failed'), step('passed')], []],
];

describe('deriveRunStatus (#296)', () => {
  test.each(CASES)('%s -> %s', (_name, expected, steps, assertions) => {
    expect(deriveRunStatus(steps, assertions)).toBe(expected);
  });
});

const pendingStep = () => ({ step_id: 's', status: 'passed', needs_agent: true });

// The #275 matrix: error step > failed step > failed assertion > pending > passed.
const PENDING_CASES = [
  ['a pending assertion alone', 'incomplete', [step('passed')], [assertion('needs_agent')]],
  ['a pending step alone', 'incomplete', [pendingStep()], []],
  ['a pending assertion beside a passed one', 'incomplete', [], [assertion('passed'), assertion('needs_agent')]],
  ['a failed assertion beats a pending one', 'failed', [], [assertion('needs_agent'), assertion('failed')]],
  ['a failed step beats a pending assertion', 'failed', [step('failed')], [assertion('needs_agent')]],
  ['an errored step beats a pending step', 'error', [pendingStep(), step('error')], []],
  ['a failed assertion beats a pending step', 'failed', [pendingStep()], [assertion('failed')]],
  ['needs_agent: false is not pending', 'passed', [{ ...pendingStep(), needs_agent: false }], []],
];

// An incomplete run exports no failure and at least one skipped case; a red
// one still exports its real failures (plan decision 6).
describe('pending statuses agree with the JUnit export (#275)', () => {
  test.each(PENDING_CASES)('%s', (_name, _expected, steps, assertions) => {
    const status = deriveRunStatus(steps, assertions);
    const report = toJUnit([{ run_id: 'run_20261111_120000', scenario_id: 'x', status, steps_executed: steps, assertion_results: assertions, summary: 'x' }]);
    if (status === 'incomplete') {
      expect(report.failures).toBe(0);
      expect(report.skipped).toBeGreaterThan(0);
    } else if (status === 'passed') {
      expect(report.failures).toBe(0);
      expect(report.skipped).toBe(0);
    } else {
      const [suite] = findAll(parseXml(report.xml), 'testsuite');
      expect(suite.children.some((c) => c.attrs.name === 'run status')).toBe(false);
      expect(report.failures).toBeGreaterThan(0);
    }
  });
});

describe('deriveRunStatus with pending entries (#275)', () => {
  test.each(PENDING_CASES)('%s -> %s', (_name, expected, steps, assertions) => {
    expect(deriveRunStatus(steps, assertions)).toBe(expected);
  });

  test.each([
    [assertion('needs_agent'), true],
    [assertion('passed'), false],
    [assertion('failed'), false],
    [null, false],
    ['x', false],
  ])('isPendingAssertion(%p) is %s', (entry, expected) => {
    expect(isPendingAssertion(entry)).toBe(expected);
  });

  test.each([
    [pendingStep(), true],
    [{ ...pendingStep(), needs_agent: 'true' }, false],
    [step('passed'), false],
    [null, false],
    [7, false],
  ])('isPendingStep(%p) is %s', (entry, expected) => {
    expect(isPendingStep(entry)).toBe(expected);
  });
});

// The derived status and the JUnit export must never disagree: a red result
// is red because of a recorded step or assertion (not the synthetic
// "run status" fallback), and a green one exports zero failures.
describe('deriveRunStatus agrees with the JUnit export (#296)', () => {
  test.each(CASES)('%s', (_name, _expected, steps, assertions) => {
    const status = deriveRunStatus(steps, assertions);
    const result = {
      run_id: 'run_20261110_120000',
      scenario_id: 'cross_check',
      status,
      steps_executed: steps,
      assertion_results: assertions,
      summary: 'x',
    };
    const report = toJUnit([result]);
    const [suite] = findAll(parseXml(report.xml), 'testsuite');
    const failing = suite.children.filter(
      (c) => c.name === 'testcase' && c.children.some((n) => n.name === 'failure')
    );
    const real = failing.filter((c) => c.attrs.name !== 'run status');

    if (status === 'passed') {
      expect(report.failures).toBe(0);
    } else {
      expect(real.length).toBeGreaterThan(0);
      expect(real.length).toBe(report.failures);
    }
  });
});
