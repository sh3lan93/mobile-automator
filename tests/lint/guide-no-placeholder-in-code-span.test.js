'use strict';

const fs = require('fs');
const path = require('path');

const CONTENT_DIR = path.resolve(__dirname, '../../src/guide/content');

// Every ported guide content file (aware + agnostic). The invariants files are
// placeholder-free by construction, so they are not scanned here.
const FILES = [
  'execute.aware.md',
  'execute.agnostic.md',
  'generate.aware.md',
  'generate.agnostic.md',
  'setup.aware.md',
  'setup.agnostic.md',
];

// A placeholder token must never sit inside a markdown code span (backticks).
// If it did, an unconfigured workspace would interpolate the fallback note
// inside the span; a backtick-bearing fallback would then nest backticks and
// produce malformed markdown (and, worse, present the fallback as the command
// to run). This guard scans the raw content files so the invariant is enforced
// at the source, before any interpolation.
function placeholderInsideCodeSpan(text) {
  for (const line of text.split('\n')) {
    const parts = line.split('`');
    // parts[0] is outside the first span, parts[1] is inside it, parts[2]
    // outside, ... so every odd index is the interior of a code span.
    for (let i = 1; i < parts.length; i += 2) {
      if (/\{\{\s*[a-zA-Z0-9_.]+\s*\}\}/.test(parts[i])) {
        return line;
      }
    }
  }
  return null;
}

describe('guide content — no placeholder inside a code span', () => {
  for (const file of FILES) {
    it(`${file} has no {{placeholder}} inside a code span`, () => {
      const text = fs.readFileSync(path.join(CONTENT_DIR, file), 'utf8');
      const bad = placeholderInsideCodeSpan(text);
      expect(bad).toBeNull();
    });
  }
});
