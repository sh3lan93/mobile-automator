'use strict';

const { skillTemplatesForMode } = require('../../../scripts/install-skills');

describe('skillTemplatesForMode recorder install', () => {
  test('agnostic mode installs the agnostic recorder skill', () => {
    const t = skillTemplatesForMode('platform-agnostic');
    const rec = t.find((x) => x.dest === '.gemini/skills/mobile-automator-recorder/SKILL.md');
    expect(rec).toBeTruthy();
    expect(rec.src).toBe('mobile-automator-recorder/agnostic/SKILL.md');
  });

  test('aware mode still installs the aware recorder skill', () => {
    const t = skillTemplatesForMode('platform-aware');
    const rec = t.find((x) => x.dest === '.gemini/skills/mobile-automator-recorder/SKILL.md');
    expect(rec.src).toBe('mobile-automator-recorder/aware/SKILL.md');
  });
});
