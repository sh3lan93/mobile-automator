'use strict';

const { parsePositiveInt } = require('../../../src/util/parse-positive-int');

describe('parsePositiveInt', () => {
  test.each([
    [800, 800],
    ['800', 800],
    ['007', 7],
    [1, 1],
  ])('accepts %p', (raw, expected) => {
    expect(parsePositiveInt(raw)).toBe(expected);
  });

  test.each([
    [0], ['0'], [-5], ['-5'], [1.5], ['1.5'], ['5.0'], ['1e3'], ['0x10'], [' 5 '], [''],
    ['abc'], [NaN], [Infinity], [true], [null], [undefined], [[5]], [{}],
  ])('rejects %p', (raw) => {
    expect(parsePositiveInt(raw)).toBeNull();
  });
});
