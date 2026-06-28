'use strict';

const fs = require('fs');
const path = require('path');

const CONTENT_DIR = path.resolve(__dirname, '../../src/guide/content');
const TOPICS = ['generate', 'execute', 'setup'];

// Anchor phrases that MUST appear verbatim in both the invariants snippet and
// the matching guide content (drift guard): if the discipline is removed from
// the guide, the anchor disappears and this test fails.
const ANCHORS = {
  generate: 'do NOT plan or suggest steps',
  execute: 'exactly as written',
  setup: 'Inspect real project files',
};

// OS names forbidden in invariants so one snippet is safe for agnostic installs.
const OS_WORDS = /\b(android|ios|iphone|ipad|xcode|gradle|adb|simulator|emulator|swift|kotlin)\b/i;

describe('skill invariants snippets', () => {
  for (const topic of TOPICS) {
    const file = path.join(CONTENT_DIR, `${topic}.invariants.md`);

    it(`${topic}.invariants.md exists and is non-empty`, () => {
      expect(fs.existsSync(file)).toBe(true);
      expect(fs.readFileSync(file, 'utf8').trim().length).toBeGreaterThan(0);
    });

    it(`${topic}.invariants.md has no {{ placeholder, no mobile_ tool, no OS name`, () => {
      const body = fs.readFileSync(file, 'utf8');
      expect(body).not.toContain('{{');
      expect(body).not.toMatch(/\bmobile_[a-z_]+/);
      expect(body).not.toMatch(OS_WORDS);
    });

    it(`${topic}.invariants.md anchor also appears in both guide variants`, () => {
      const snippet = fs.readFileSync(file, 'utf8');
      const anchor = ANCHORS[topic];
      expect(snippet).toContain(anchor);
      for (const variant of ['aware', 'agnostic']) {
        const guide = fs.readFileSync(path.join(CONTENT_DIR, `${topic}.${variant}.md`), 'utf8');
        expect(guide).toContain(anchor);
      }
    });
  }
});
