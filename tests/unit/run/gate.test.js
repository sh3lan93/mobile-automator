'use strict';

const { replayEnabled } = require('../../../src/run/gate');

describe('replayEnabled', () => {
  test("is on only for exactly '1'", () => {
    expect(replayEnabled({ MAUTO_REPLAY: '1' })).toBe(true);
  });

  test.each([['0'], ['true'], [''], [undefined], [' 1'], ['1 '], ['yes']])('is off for %p', (value) => {
    expect(replayEnabled(value === undefined ? {} : { MAUTO_REPLAY: value })).toBe(false);
  });

  test('reads process.env by default', () => {
    const saved = process.env.MAUTO_REPLAY;
    try {
      process.env.MAUTO_REPLAY = '1';
      expect(replayEnabled()).toBe(true);
      delete process.env.MAUTO_REPLAY;
      expect(replayEnabled()).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.MAUTO_REPLAY;
      else process.env.MAUTO_REPLAY = saved;
    }
  });
});
