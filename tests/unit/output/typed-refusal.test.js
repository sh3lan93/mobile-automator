'use strict';

const { TypedRefusal, isTypedRefusal } = require('../../../src/output/typed-refusal');
const { ResultStoreRefusal } = require('../../../src/result/refusal');
const { InvalidRunIdError } = require('../../../src/result/store');
const { UnsafePathError } = require('../../../src/workspace/safe-fs');
const { OutputPathRefusal } = require('../../../src/workspace/output-roots');

describe('TypedRefusal: the one base every typed refusal extends (#347)', () => {
  test('carries its kind, message and hint, and names its subclass', () => {
    class Sample extends TypedRefusal {}
    const err = new Sample('invalid_input', 'no', 'try again');
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ name: 'Sample', kind: 'invalid_input', message: 'no', hint: 'try again' });
    expect(isTypedRefusal(err)).toBe(true);
  });

  test('every refusal class is one, keeping its own name, kind and fields', () => {
    const store = new ResultStoreRefusal('m', 'h');
    expect(isTypedRefusal(store)).toBe(true);
    expect(store).toMatchObject({ name: 'ResultStoreRefusal', kind: 'invalid_input', hint: 'h' });

    expect(isTypedRefusal(new InvalidRunIdError('/p', 'bad/id'))).toBe(true);

    const unsafe = new UnsafePathError('/p/.mobile-automator/x', 'symlink');
    expect(isTypedRefusal(unsafe)).toBe(true);
    expect(unsafe).toMatchObject({ name: 'UnsafePathError', code: 'EUNSAFEPATH', kind: 'environment', reason: 'symlink' });
    const scoped = unsafe.inScope('path');
    expect(isTypedRefusal(scoped)).toBe(true);
    expect(scoped).toMatchObject({ name: 'UnsafePathError', kind: 'environment', scope: 'path' });

    const out = new OutputPathRefusal('m', 'h');
    expect(isTypedRefusal(out)).toBe(true);
    expect(out).toMatchObject({ name: 'OutputPathRefusal', kind: 'invalid_input', hint: 'h' });
  });

  test('an ordinary error is not one', () => {
    const fsErr = Object.assign(new Error('nope'), { code: 'EACCES' });
    expect(isTypedRefusal(fsErr)).toBe(false);
    expect(isTypedRefusal(null)).toBe(false);
    expect(isTypedRefusal({ kind: 'environment', message: 'm', hint: 'h' })).toBe(false);
  });
});
