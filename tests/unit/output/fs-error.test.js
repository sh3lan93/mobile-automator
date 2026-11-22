'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { isFsError } = require('../../../src/output/fs-error');
const { UnsafePathError } = require('../../../src/workspace/safe-fs');
const { OutputPathRefusal } = require('../../../src/workspace/output-roots');

// The predicate a write-failure catch narrows to (#347): a filesystem error is
// the handler's to report, anything else passes through to the envelope
// boundary.
describe('isFsError', () => {
  function thrownBy(fn) {
    try {
      fn();
    } catch (err) {
      return err;
    }
    throw new Error('expected a throw');
  }

  it('is true for the errors fs calls raise, beyond the environment set', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-fs-error-'));
    expect(isFsError(thrownBy(() => fs.readFileSync(path.join(dir, 'absent'))))).toBe(true); // ENOENT
    expect(isFsError(thrownBy(() => fs.readFileSync(dir)))).toBe(true); // EISDIR
    fs.writeFileSync(path.join(dir, 'f'), '');
    expect(isFsError(thrownBy(() => fs.readFileSync(path.join(dir, 'f', 'x'))))).toBe(true); // ENOTDIR
  });

  it('is false for a typed refusal, even one carrying an E-prefixed code', () => {
    const unsafe = new UnsafePathError('/x', 'symlink');
    expect(unsafe.code).toBe('EUNSAFEPATH');
    expect(isFsError(unsafe)).toBe(false);
    expect(isFsError(new OutputPathRefusal('m', 'h'))).toBe(false);
  });

  it('is false for a code bug and for no error at all', () => {
    expect(isFsError(new TypeError('x is not a function'))).toBe(false);
    expect(isFsError(Object.assign(new Error('m'), { code: 'corrupt_mcp_config' }))).toBe(false);
    expect(isFsError(null)).toBe(false);
    expect(isFsError(undefined)).toBe(false);
  });
});
