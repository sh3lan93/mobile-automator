'use strict';

const { renderSkill, SKILL_TOPICS } = require('../../../src/init/skill-renderer');

describe('renderSkill', () => {
  it('exposes the three topics', () => {
    expect(SKILL_TOPICS.sort()).toEqual(['execute', 'generate', 'setup']);
  });

  for (const topic of ['generate', 'execute', 'setup']) {
    const { dirName, content } = renderSkill(topic);

    it(`${topic}: dirName matches the skill name`, () => {
      expect(dirName).toBe(`mobile-automator-${topic}`);
    });

    it(`${topic}: has YAML frontmatter with name and description`, () => {
      expect(content.startsWith('---\n')).toBe(true);
      expect(content).toMatch(new RegExp(`name: mobile-automator-${topic}\\n`));
      expect(content).toMatch(/\ndescription: /);
    });

    it(`${topic}: body inlines invariants and points to the guide`, () => {
      expect(content).toContain('Non-negotiable directives');
      expect(content).toContain(`mauto guide ${topic}`);
    });

    it(`${topic}: leaks no placeholder and no mobile_ tool name`, () => {
      expect(content).not.toContain('{{');
      expect(content).not.toMatch(/\bmobile_[a-z_]+/);
    });
  }

  it('throws on an unknown topic', () => {
    expect(() => renderSkill('nope')).toThrow(/unknown skill topic/);
  });
});
