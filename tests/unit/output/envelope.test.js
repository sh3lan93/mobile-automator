'use strict';

const {
  SCHEMA_VERSION,
  EXIT,
  ok,
  fail,
  exitCodeFor,
  render,
} = require('../../../src/output/envelope');

describe('envelope', () => {
  test('SCHEMA_VERSION is 2.1', () => {
    expect(SCHEMA_VERSION).toBe('2.1');
  });

  test('EXIT map has the documented codes', () => {
    expect(EXIT).toEqual({
      OK: 0,
      DEVICE: 2,
      INVALID_INPUT: 3,
      TARGET_NOT_FOUND: 4,
      CANCEL: 130,
    });
  });

  describe('ok()', () => {
    test('wraps data with ok:true and schema_version', () => {
      const env = ok({ a: 1 });
      expect(env).toEqual({
        ok: true,
        data: { a: 1 },
        schema_version: '2.1',
      });
    });

    test('handles array data', () => {
      const env = ok([{ text: 'x' }]);
      expect(env.ok).toBe(true);
      expect(env.data).toEqual([{ text: 'x' }]);
    });
  });

  describe('fail()', () => {
    test('builds error envelope with default null hint', () => {
      const env = fail('device', 'no device');
      expect(env).toEqual({
        ok: false,
        error: { kind: 'device', message: 'no device' },
        hint: null,
        schema_version: '2.1',
      });
    });

    test('carries a hint when provided', () => {
      const env = fail('invalid_input', 'bad json', 'check the file');
      expect(env.hint).toBe('check the file');
      expect(env.error).toEqual({ kind: 'invalid_input', message: 'bad json' });
    });
  });

  describe('exitCodeFor()', () => {
    test.each([
      ['ok', 0],
      ['device', 2],
      ['invalid_input', 3],
      ['target_not_found', 4],
      ['cancel', 130],
      ['internal', 1],
    ])('maps %s -> %i', (kind, code) => {
      expect(exitCodeFor(kind)).toBe(code);
    });

    test('unknown kind falls back to internal (1)', () => {
      expect(exitCodeFor('something_else')).toBe(1);
    });
  });

  describe('render()', () => {
    test('default renders JSON string of the envelope', () => {
      const env = ok({ a: 1 });
      expect(render(env)).toBe(JSON.stringify(env));
    });

    test('human mode renders readable text for ok', () => {
      const out = render(ok({ a: 1 }), { human: true });
      expect(out).toMatch(/ok/i);
      expect(out).not.toBe(JSON.stringify(ok({ a: 1 })));
    });

    test('human mode renders readable text for fail including message', () => {
      const out = render(fail('device', 'no device connected'), { human: true });
      expect(out).toMatch(/no device connected/);
    });
  });
});
