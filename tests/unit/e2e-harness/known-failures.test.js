'use strict';

const { classify, isJobFailure, outcomeMessage } = require('../../../sample-app/scripts/lib/known-failures');

const knownFailures = {
  golden_search_empty: { issue: 251, reason: 'engine drops TextField labels', failing_step: 'tap_search' },
};

describe('classify', () => {
  test('an unlisted scenario that passed is pass', () => {
    expect(classify({ scenarioId: 'smoke_nav', passed: true, failedStep: null, knownFailures })).toBe('pass');
  });

  test('an unlisted scenario that failed is fail', () => {
    expect(classify({ scenarioId: 'smoke_nav', passed: false, failedStep: 'tap_more', knownFailures })).toBe('fail');
  });

  test('a listed scenario that failed AT its failing_step is xfail', () => {
    expect(classify({ scenarioId: 'golden_search_empty', passed: false, failedStep: 'tap_search', knownFailures })).toBe('xfail');
  });

  test('a listed scenario that failed at a DIFFERENT step is fail, not xfail', () => {
    // The real case: a launch failure (an unrelated uiautomator crash) was
    // once excused as the #251 known failure.
    expect(classify({ scenarioId: 'golden_search_empty', passed: false, failedStep: 'launch', knownFailures })).toBe('fail');
  });

  test('a listed scenario that failed only on assertions (no failed step) is fail', () => {
    expect(classify({ scenarioId: 'golden_search_empty', passed: false, failedStep: null, knownFailures })).toBe('fail');
  });

  test('a listed scenario that passed is xpass', () => {
    expect(classify({ scenarioId: 'golden_search_empty', passed: true, failedStep: null, knownFailures })).toBe('xpass');
  });

  test('an entry without failing_step never excuses a failure', () => {
    const loose = { golden_search_empty: { issue: 251, reason: 'r' } };
    expect(classify({ scenarioId: 'golden_search_empty', passed: false, failedStep: 'tap_search', knownFailures: loose })).toBe('fail');
  });

  test('a missing known-failures map treats everything as unlisted', () => {
    expect(classify({ scenarioId: 'golden_search_empty', passed: false, failedStep: 'tap_search' })).toBe('fail');
  });
});

describe('classify — per-engine entries (#251)', () => {
  const scoped = {
    golden_search_empty: { issue: 251, reason: 'r', failing_step: 'tap_search', engines: ['mobilecli'] },
  };

  test('an entry scoped to the current engine excuses a failure at its failing_step', () => {
    expect(
      classify({ scenarioId: 'golden_search_empty', passed: false, failedStep: 'tap_search', knownFailures: scoped, engine: 'mobilecli' })
    ).toBe('xfail');
  });

  test('an entry scoped to the current engine still makes a pass an xpass', () => {
    expect(
      classify({ scenarioId: 'golden_search_empty', passed: true, failedStep: null, knownFailures: scoped, engine: 'mobilecli' })
    ).toBe('xpass');
  });

  test('on another engine the entry is ignored: passing is a plain pass', () => {
    expect(
      classify({ scenarioId: 'golden_search_empty', passed: true, failedStep: null, knownFailures: scoped, engine: 'legacy' })
    ).toBe('pass');
  });

  test('on another engine the entry is ignored: failing, even at failing_step, is fail', () => {
    expect(
      classify({ scenarioId: 'golden_search_empty', passed: false, failedStep: 'tap_search', knownFailures: scoped, engine: 'legacy' })
    ).toBe('fail');
  });

  test('an entry without engines applies to every engine', () => {
    for (const engine of ['mobilecli', 'legacy']) {
      expect(classify({ scenarioId: 'golden_search_empty', passed: true, failedStep: null, knownFailures, engine })).toBe('xpass');
    }
  });

  test('an engine-scoped entry with no current engine is a harness error, not a silent pass', () => {
    expect(() =>
      classify({ scenarioId: 'golden_search_empty', passed: true, failedStep: null, knownFailures: scoped })
    ).toThrow(/engine/);
  });

  test('outcomeMessage ignores an entry scoped to another engine', () => {
    expect(
      outcomeMessage({ scenarioId: 'golden_search_empty', outcome: 'fail', knownFailures: scoped, failedStep: 'tap_search', engine: 'legacy' })
    ).toBe('golden_search_empty: FAIL');
  });

  test('outcomeMessage names the engine an xfail is scoped to', () => {
    const msg = outcomeMessage({
      scenarioId: 'golden_search_empty',
      outcome: 'xfail',
      knownFailures: scoped,
      failedStep: 'tap_search',
      engine: 'mobilecli',
    });
    expect(msg).toContain('XFAIL');
    expect(msg).toContain('mobilecli');
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

  test('xfail names the tracking issue, reason and failure point', () => {
    const msg = outcomeMessage({ scenarioId: 'golden_search_empty', outcome: 'xfail', knownFailures, failedStep: 'tap_search' });
    expect(msg).toContain('#251');
    expect(msg).toContain('engine drops TextField labels');
    expect(msg).toContain('tap_search');
  });

  test('a listed scenario failing elsewhere names the expected and actual failure points', () => {
    const msg = outcomeMessage({ scenarioId: 'golden_search_empty', outcome: 'fail', knownFailures, failedStep: 'launch' });
    expect(msg).toMatch(/FAIL/);
    expect(msg).toContain('expected to fail at step "tap_search"');
    expect(msg).toContain('failed at step "launch"');
  });

  test('a listed scenario failing only on assertions says so', () => {
    const msg = outcomeMessage({ scenarioId: 'golden_search_empty', outcome: 'fail', knownFailures, failedStep: null });
    expect(msg).toContain('expected to fail at step "tap_search"');
    expect(msg).toMatch(/every step passed/);
  });

  test('an unlisted failure is a plain FAIL', () => {
    expect(outcomeMessage({ scenarioId: 'smoke_nav', outcome: 'fail', knownFailures, failedStep: 'x' })).toBe('smoke_nav: FAIL');
  });
});
