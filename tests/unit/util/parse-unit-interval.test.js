'use strict';

const { parseUnitInterval } = require('../../../src/util/parse-unit-interval');

describe('parseUnitInterval', () => {
  test.each([
    [0, 0],
    [1, 1],
    [0.5, 0.5],
    ['0', 0],
    ['1', 1],
    ['0.95', 0.95],
    [' 0.5 ', 0.5],
    ['.25', 0.25],
  ])('accepts %p', (raw, expected) => {
    expect(parseUnitInterval(raw)).toBe(expected);
  });

  test.each([
    [-0.1], [1.1], ['-0.1'], ['1.5'], [''], ['   '], ['abc'], ['0.5x'],
    [NaN], [Infinity], [true], [false], [null], [undefined], [[0.5]], [{}],
  ])('rejects %p', (raw) => {
    expect(parseUnitInterval(raw)).toBeNull();
  });
});
