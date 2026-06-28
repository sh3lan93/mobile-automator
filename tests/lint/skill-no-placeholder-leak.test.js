'use strict';

const { renderSkill, SKILL_TOPICS } = require('../../src/init/skill-renderer');

describe('rendered skills — no placeholder / no mcp tool leak', () => {
  for (const topic of SKILL_TOPICS) {
    it(`${topic} skill has no {{ token and no mobile_ tool name`, () => {
      const { content } = renderSkill(topic);
      expect(content).not.toContain('{{');
      expect(content).not.toMatch(/\bmobile_[a-z_]+/);
    });
  }
});
