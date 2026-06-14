'use strict';

const { emitGuide } = require('../../src/guide/emitter');

const TOPICS = ['generate', 'execute', 'record', 'setup'];

// Banned-word style mirrors tests/lint/agnostic-no-platform-words.test.js:
// case-insensitive, word-boundary anchored. In platform-agnostic mode the
// guide stubs must name no OS / OS-specific tooling — per-OS facts resolve at
// runtime via the four semantic actions, not in the guide prose.
const FORBIDDEN = [
  /\bAndroid\b/i,
  /\biOS\b/i,
  /\badb\b/i,
  /\bxcrun\b/i,
  /\bresource[ -]?id\b/i,
  /\bFlutter\b/i,
  /\bReact[ -]?Native\b/i,
  /\bKotlin\b/i,
  /\bCompose\b/i,
  /\bxcode\b/i,
  /\bsimulator\b/i,
  /\bemulator\b/i,
];

describe('guide emitter — agnostic mode names no OS', () => {
  for (const topic of TOPICS) {
    it(`${topic} (platform-agnostic) contains no OS/platform words`, () => {
      const out = emitGuide(topic, { mode: 'platform-agnostic' });
      const violations = FORBIDDEN.filter((p) => p.test(out)).map((p) => p.toString());
      expect(violations).toEqual([]);
    });
  }
});
