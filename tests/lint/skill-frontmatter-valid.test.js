'use strict';

const { renderSkill, SKILL_TOPICS } = require('../../src/init/skill-renderer');

const NAME_RE = /^[a-z0-9-]+$/;
const RESERVED = /\b(anthropic|claude)\b/i;

function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error('no frontmatter');
  const out = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

describe('rendered skills — frontmatter validity', () => {
  for (const topic of SKILL_TOPICS) {
    const { dirName, content } = renderSkill(topic);
    const fm = parseFrontmatter(content);

    it(`${topic}: name matches folder, is valid, has no reserved word`, () => {
      expect(fm.name).toBe(dirName);
      expect(fm.name).toMatch(NAME_RE);
      expect(fm.name.length).toBeLessThanOrEqual(64);
      expect(fm.name).not.toMatch(RESERVED);
    });

    it(`${topic}: description non-empty, <=1024, no XML`, () => {
      expect(fm.description.length).toBeGreaterThan(0);
      expect(fm.description.length).toBeLessThanOrEqual(1024);
      expect(fm.description).not.toMatch(/[<>]/);
    });
  }
});
