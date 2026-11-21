'use strict';

const { isPlainObject } = require('../../../src/util/is-plain-object');

describe('isPlainObject', () => {
  it('accepts a JSON object, empty or not', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(JSON.parse('{"event":"verb.end"}'))).toBe(true);
  });

  it('rejects null, arrays and primitives', () => {
    for (const v of [null, undefined, [], [{ event: 'verb.end' }], 0, 1, '', 'x', true, false]) {
      expect(isPlainObject(v)).toBe(false);
    }
  });
});
