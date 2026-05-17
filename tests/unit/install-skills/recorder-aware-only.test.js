// tests/unit/install-skills/recorder-aware-only.test.js
//
// Originally verified that the recorder was aware-only (slice #22).
// Updated in slice #29: the agnostic recorder template now exists, so
// both modes install exactly 3 templates including a mode-specific recorder.

const installSkills = require('../../../scripts/install-skills.js');

describe('skillTemplatesForMode — recorder installs in both modes', () => {
  it('platform-aware returns exactly 3 templates including the aware recorder', () => {
    const templates = installSkills.skillTemplatesForMode('platform-aware');
    expect(templates).toHaveLength(3);
    const recorder = templates.find(t => /mobile-automator-recorder\/aware\/SKILL\.md$/.test(t.src));
    expect(recorder).toBeDefined();
    expect(recorder.dest).toBe('.gemini/skills/mobile-automator-recorder/SKILL.md');
  });

  it('platform-agnostic returns exactly 3 templates including the agnostic recorder', () => {
    const templates = installSkills.skillTemplatesForMode('platform-agnostic');
    expect(templates).toHaveLength(3);
    const recorder = templates.find(t => /mobile-automator-recorder\/agnostic\/SKILL\.md$/.test(t.src));
    expect(recorder).toBeDefined();
    expect(recorder.dest).toBe('.gemini/skills/mobile-automator-recorder/SKILL.md');
  });

  it('platform-aware still includes generator and executor templates', () => {
    const templates = installSkills.skillTemplatesForMode('platform-aware');
    const dests = templates.map(t => t.dest);
    expect(dests).toContain('.gemini/skills/mobile-automator-generator/SKILL.md');
    expect(dests).toContain('.gemini/skills/mobile-automator-executor/SKILL.md');
  });
});
