'use strict';

// neutraliseControls (#349): device-sourced text must never put a raw terminal
// control character on a human's terminal.

const { neutraliseControls } = require('../../../src/output/neutralise');

describe('neutraliseControls', () => {
  test.each([
    ['NUL', '\u0000', '\\x00'],
    ['BEL', '\u0007', '\\x07'],
    ['ESC', '\u001b', '\\x1B'],
    ['CR', '\r', '\\x0D'],
    ['VT', '\u000b', '\\x0B'],
    ['US', '\u001f', '\\x1F'],
    ['DEL', '\u007f', '\\x7F'],
    ['C1 CSI', '\u009b', '\\u009B'],
    ['C1 first', '\u0080', '\\u0080'],
    ['C1 last', '\u009f', '\\u009F'],
  ])('escapes %s as uppercase hex', (_name, ch, escaped) => {
    expect(neutraliseControls(`a${ch}b`)).toBe(`a${escaped}b`);
  });

  test('a full escape sequence is rendered inert', () => {
    // eslint-disable-next-line no-control-regex -- matching control chars is the point
    expect(neutraliseControls('\u001b[2J\u001b]0;x\u0007')).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
  });

  test('keeps tab and newline by default', () => {
    expect(neutraliseControls('a\tb\nc')).toBe('a\tb\nc');
  });

  test('escapes newline with escapeNewlines, still keeps tab', () => {
    expect(neutraliseControls('a\tb\nc', { escapeNewlines: true })).toBe('a\tb\\x0Ac');
  });

  // A CR that ends a line moves the cursor nowhere a bare LF would not; a lone
  // CR returns to the line start and can forge a line (#353).
  test('multi-line mode keeps CRLF but escapes a lone CR', () => {
    expect(neutraliseControls('a\r\nb\rc\x1bd')).toBe('a\r\nb\\x0Dc\\x1Bd');
  });

  test('escapeNewlines escapes both halves of a CRLF', () => {
    expect(neutraliseControls('a\r\nb', { escapeNewlines: true })).toBe('a\\x0D\\x0Ab');
  });

  test('passes non-strings through unchanged', () => {
    const obj = { a: 1 };
    expect(neutraliseControls(obj)).toBe(obj);
    expect(neutraliseControls(42)).toBe(42);
    expect(neutraliseControls(null)).toBeNull();
    expect(neutraliseControls(undefined)).toBeUndefined();
  });

  test('leaves plain text and non-control Unicode untouched', () => {
    const s = 'Café 🚀 a b ÿ   plain [ok]';
    expect(neutraliseControls(s)).toBe(s);
  });
});
