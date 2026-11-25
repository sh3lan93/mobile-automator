'use strict';

// tests/lint/markdown.js is the one markdown reader every prose guard slices
// docs with, so its fence handling is pinned here: a `#` line inside any fence
// (a shell comment, a nested or stray fence) is never a heading (#312).

const { fencedBlocks, headings, section, requireSection } = require('./markdown');

const NESTED = [
  '## A',
  '````md',
  '```bash',
  '# not a heading',
  '```',
  '````',
  'after',
  '```bash',
  '# c',
  '```bash',
  'x',
  '```',
  '## B',
  'y',
].join('\n');

describe('tests/lint/markdown.js — one fence state machine', () => {
  test('a longer fence wrapping a shorter one is one block, and a stray opener does not close a block', () => {
    expect(fencedBlocks(NESTED).map((b) => b.lang)).toEqual(['md', 'bash']);
  });

  test('headings skips every `#` line inside a fence', () => {
    expect(headings(NESTED).map((h) => h.text)).toEqual(['A', 'B']);
  });

  test('section runs to the next real heading, past fenced `#` lines', () => {
    const body = section(NESTED, '## A');
    expect(body).toContain('after');
    expect(body).not.toContain('y');
  });

  test('section ignores a heading-shaped line inside a fence', () => {
    expect(section('```\n## A\n```\n## A\nbody\n## Z', '## A')).toBe('body');
    expect(section('```\n## A\n```\n', '## A')).toBeNull();
  });

  test('requireSection returns the body, and throws naming the file and heading when it is gone', () => {
    expect(requireSection('## A\nbody', '## A', 'x.md')).toBe('body');
    expect(() => requireSection('## A\nbody', '## Z', 'x.md')).toThrow('x.md: no "## Z" section found');
  });
});
