'use strict';

const { classify, isJobFailure, outcomeMessage } = require('../../../sample-app/scripts/lib/known-failures');

const knownFailures = { golden_search_empty: { issue: 251, reason: 'engine drops TextField labels' } };

describe('classify', () => {
  test('an unlisted scenario that passed is pass', () => {
    expect(classify({ scenarioId: 'smoke_nav', passed: true, knownFailures })).toBe('pass');
  });

  test('an unlisted scenario that failed is fail', () => {
    expect(classify({ scenarioId: 'smoke_nav', passed: false, knownFailures })).toBe('fail');
  });

  test('a listed scenario that failed is xfail', () => {
    expect(classify({ scenarioId: 'golden_search_empty', passed: false, knownFailures })).toBe('xfail');
  });

  test('a listed scenario that passed is xpass', () => {
    expect(classify({ scenarioId: 'golden_search_empty', passed: true, knownFailures })).toBe('xpass');
  });

  test('a missing known-failures map treats everything as unlisted', () => {
    expect(classify({ scenarioId: 'golden_search_empty', passed: false })).toBe('fail');
  });
});

describe('isJobFailure', () => {
  test('fail and xpass fail the job; pass and xfail do not', () => {
    expect(isJobFailure('fail')).toBe(true);
    expect(isJobFailure('xpass')).toBe(true);
    expect(isJobFailure('pass')).toBe(false);
    expect(isJobFailure('xfail')).toBe(false);
  });
});

describe('outcomeMessage', () => {
  test('xpass tells you to remove the entry from known-failures.json', () => {
    const msg = outcomeMessage({ scenarioId: 'golden_search_empty', outcome: 'xpass', knownFailures });
    expect(msg).toContain('known-failures.json');
    expect(msg).toMatch(/remove/i);
    expect(msg).toContain('#251');
  });

  test('xfail names the tracking issue and reason', () => {
    const msg = outcomeMessage({ scenarioId: 'golden_search_empty', outcome: 'xfail', knownFailures });
    expect(msg).toContain('#251');
    expect(msg).toContain('engine drops TextField labels');
  });
});
