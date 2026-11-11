'use strict';

const { makeRunId } = require('../../../src/run/run-id');
const { isResultRunId } = require('../../../src/result/store');

describe('makeRunId', () => {
  test('formats the instant as run_YYYYMMDD_HHMMSS in UTC', () => {
    expect(makeRunId(new Date(Date.UTC(2026, 10, 9, 7, 5, 3)))).toBe('run_20261109_070503');
  });

  test('is UTC regardless of the local offset', () => {
    // 23:59:59 UTC on Dec 31 is already the next day east of Greenwich.
    expect(makeRunId(new Date('2026-12-31T23:59:59Z'))).toBe('run_20261231_235959');
  });

  test('is a run id the result store accepts', () => {
    expect(isResultRunId(makeRunId(new Date()))).toBe(true);
  });
});
