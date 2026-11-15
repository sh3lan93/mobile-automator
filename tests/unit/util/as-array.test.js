'use strict';

const { asArray } = require('../../../src/util/as-array');

test('an array is returned as is, entries untouched', () => {
  const list = [1, null, { a: 1 }];
  expect(asArray(list)).toBe(list);
});

test.each([undefined, null, 'x', 3, { length: 1 }])('%j is empty', (value) => {
  expect(asArray(value)).toEqual([]);
});
