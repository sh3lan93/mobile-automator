'use strict';

const { SKILL_META } = require('../../../src/init/skill-meta');

const TOPICS = ['generate', 'execute', 'setup'];
const RESERVED = /\b(anthropic|claude)\b/i;
const NAME_RE = /^[a-z0-9-]+$/;

describe('SKILL_META', () => {
  it('has an entry per topic', () => {
    expect(Object.keys(SKILL_META).sort()).toEqual([...TOPICS].sort());
  });

  for (const topic of TOPICS) {
    it(`${topic} name is valid and topic-derived`, () => {
      const { name } = SKILL_META[topic];
      expect(name).toBe(`mobile-automator-${topic}`);
      expect(name).toMatch(NAME_RE);
      expect(name.length).toBeLessThanOrEqual(64);
      expect(name).not.toMatch(RESERVED);
    });

    it(`${topic} description is non-empty, <=1024 chars, no XML, no placeholder`, () => {
      const { description } = SKILL_META[topic];
      expect(description.length).toBeGreaterThan(0);
      expect(description.length).toBeLessThanOrEqual(1024);
      expect(description).not.toMatch(/[<>]/);
      expect(description).not.toContain('{{');
      // Good discovery descriptions say WHEN to use the skill.
      expect(description.toLowerCase()).toContain('use when');
    });
  }
});
