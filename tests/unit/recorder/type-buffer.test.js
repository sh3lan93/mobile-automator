'use strict';

const { TypeBuffer } = require('../../../tools/recorder/src/coalesce/type-buffer');

const KEYBOARD = { in_keyboard: true };
const FIELD_PASSWORD = { id: 'password_input', label: 'Password', sensitive: true };
const FIELD_EMAIL = { id: 'email_input', label: 'Email', sensitive: false };

describe('TypeBuffer', () => {
  test('coalesces sequential keyboard taps into one type event on focus change', () => {
    const out = [];
    const buf = new TypeBuffer({ emit: (e) => out.push(e), silenceTimeoutMs: 9999 });
    buf.observeFocus({ t: 100, field: FIELD_EMAIL });
    buf.observeKeyboardTap({ t: 110, key: 't' });
    buf.observeKeyboardTap({ t: 130, key: 'e' });
    buf.observeKeyboardTap({ t: 150, key: 's' });
    buf.observeKeyboardTap({ t: 170, key: 't' });
    buf.observeFocus({ t: 200, field: FIELD_PASSWORD });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: 'type',
      t: 110,
      value: 'test',
      field_id: 'email_input',
      sensitive: false,
    });
  });

  test('emits type with sensitive=true when field is a password input', () => {
    const out = [];
    const buf = new TypeBuffer({ emit: (e) => out.push(e), silenceTimeoutMs: 9999 });
    buf.observeFocus({ t: 100, field: FIELD_PASSWORD });
    buf.observeKeyboardTap({ t: 110, key: 's' });
    buf.observeKeyboardTap({ t: 130, key: '3' });
    buf.observeKeyboardTap({ t: 150, key: 'cret' });
    buf.flush();
    expect(out[0]).toMatchObject({ value: 's3cret', sensitive: true, field_id: 'password_input' });
  });

  test('flushes when silence timeout elapses', () => {
    const out = [];
    const buf = new TypeBuffer({ emit: (e) => out.push(e), silenceTimeoutMs: 100, now: () => 1000 });
    buf.observeFocus({ t: 100, field: FIELD_EMAIL });
    buf.observeKeyboardTap({ t: 110, key: 'a' });
    buf._setNowForTest(1300);
    buf.tick();
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe('a');
  });

  test('Enter key flushes immediately', () => {
    const out = [];
    const buf = new TypeBuffer({ emit: (e) => out.push(e), silenceTimeoutMs: 9999 });
    buf.observeFocus({ t: 100, field: FIELD_EMAIL });
    buf.observeKeyboardTap({ t: 110, key: 'a' });
    buf.observeKeyboardTap({ t: 130, key: 'b' });
    buf.observeKeyboardTap({ t: 150, key: '\n' });
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe('ab');
  });

  test.each([
    ['Enter'],
    ['Return'],
    ['Done'],
    ['Search'],
    ['Send'],
    ['Go'],
    ['↵'],
    ['enter'],
    ['return'],
    ['DONE'],
  ])('label "%s" flushes the buffer immediately and is NOT appended to value', (label) => {
    const out = [];
    const buf = new TypeBuffer({ emit: (e) => out.push(e), silenceTimeoutMs: 9999 });
    buf.observeFocus({ t: 100, field: FIELD_EMAIL });
    buf.observeKeyboardTap({ t: 110, key: 'a' });
    buf.observeKeyboardTap({ t: 130, key: 'b' });
    buf.observeKeyboardTap({ t: 150, key: label });
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe('ab');
  });

  test('flush() commits any pending buffer at session end', () => {
    const out = [];
    const buf = new TypeBuffer({ emit: (e) => out.push(e), silenceTimeoutMs: 9999 });
    buf.observeFocus({ t: 100, field: FIELD_EMAIL });
    buf.observeKeyboardTap({ t: 110, key: 'x' });
    buf.flush();
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe('x');
  });

  test('keyboard tap with no focused field is dropped silently', () => {
    const out = [];
    const buf = new TypeBuffer({ emit: (e) => out.push(e), silenceTimeoutMs: 9999 });
    buf.observeKeyboardTap({ t: 110, key: 'a' });
    buf.flush();
    expect(out).toHaveLength(0);
  });
});
