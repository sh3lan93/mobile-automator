'use strict';

const { observeEnabled } = require('../../../src/observe/gate');

describe('observeEnabled', () => {
  it('is off by default — an unset gate means the feature is absent', () => {
    expect(observeEnabled({})).toBe(false);
  });

  it('is on for exactly "1"', () => {
    expect(observeEnabled({ MAUTO_OBSERVE: '1' })).toBe(true);
  });

  it('is off for every other value, including truthy-looking ones', () => {
    // Deliberately strict. The design names the gate `MAUTO_OBSERVE=1`, and a
    // gate that also accepts "true"/"yes"/"0"-with-whitespace is a gate whose
    // real vocabulary nobody can state. One value, documented, testable.
    for (const v of ['', '0', 'true', 'yes', 'on', ' 1', '1 ', 'MAUTO_OBSERVE']) {
      expect(observeEnabled({ MAUTO_OBSERVE: v })).toBe(false);
    }
  });

  it('never throws on a hostile env, and reports off', () => {
    for (const e of [null, 0, '', false, NaN, 'a string', 42]) {
      expect(observeEnabled(e)).toBe(false);
    }
  });

  // The declared contract is `observeEnabled(env = process.env)`. Without the
  // default, a bare call — which is what the contract invites — returns false
  // FOREVER and silently disables the whole gated surface. The current callers
  // all happen to pass `env` explicitly, so nothing would have caught this;
  // that is precisely why the guarantee belongs in the module.
  describe('defaults to process.env when called with no argument', () => {
    const original = process.env.MAUTO_OBSERVE;
    afterEach(() => {
      if (original === undefined) delete process.env.MAUTO_OBSERVE;
      else process.env.MAUTO_OBSERVE = original;
    });

    it('is on when the ambient gate is set', () => {
      process.env.MAUTO_OBSERVE = '1';
      expect(observeEnabled()).toBe(true);
    });

    it('is off when the ambient gate is unset', () => {
      delete process.env.MAUTO_OBSERVE;
      expect(observeEnabled()).toBe(false);
    });
  });
});
