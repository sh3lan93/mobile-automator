'use strict';

const {
  MAX_ENTRY_LEN,
  sanitizeEntryText,
  validateEntryText,
  parseEntries,
  renderEntries,
  hasText,
} = require('../../../src/memory/entries');

describe('memory/entries', () => {
  test('sanitize collapses control chars/newlines to single spaces and trims', () => {
    expect(sanitizeEntryText('  a\tb\nc  ')).toBe('a b c');
    // printable punctuation must survive (guards against a space-to-hyphen range)
    expect(sanitizeEntryText('onboarding top-right ~500ms')).toBe('onboarding top-right ~500ms');
    expect(sanitizeEntryText('x-y')).toBe('x-y'); // preserves hyphens
  });

  test('validate rejects empty, too-long, and {{ placeholder text', () => {
    expect(validateEntryText('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(validateEntryText('x'.repeat(MAX_ENTRY_LEN + 1))).toEqual({ ok: false, reason: 'too_long' });
    expect(validateEntryText('has {{token}}')).toEqual({ ok: false, reason: 'placeholder' });
  });

  test('validate returns the sanitized value on success', () => {
    expect(validateEntryText('  tap Skip\nfirst  ')).toEqual({ ok: true, value: 'tap Skip first' });
  });

  test('render→parse round-trips entries', () => {
    const md = renderEntries('app-knowledge', [
      { date: '2026-07-12', text: 'search bar needs ~500ms settle' },
    ]);
    expect(md).toContain('# App Knowledge');
    expect(md).toContain('- [2026-07-12][asserted] search bar needs ~500ms settle');
    const back = parseEntries(md);
    expect(back).toEqual([{ date: '2026-07-12', text: 'search bar needs ~500ms settle' }]);
  });

  test('parse is CRLF-safe and tolerant of junk lines', () => {
    const md = '# App Knowledge\r\n- [2026-07-12][asserted] hello\r\njunk line\r\n';
    expect(parseEntries(md)).toEqual([{ date: '2026-07-12', text: 'hello' }]);
  });

  test('hasText matches exact entry text (de-dupe)', () => {
    const entries = [{ date: '2026-07-11', text: 'always assert the toast' }];
    expect(hasText(entries, 'always assert the toast')).toBe(true);
    expect(hasText(entries, 'assert the toast')).toBe(false);
  });
});
