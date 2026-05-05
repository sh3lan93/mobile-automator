// tests/unit/install-skills/recorder-aware-only.test.js
//
// Task 3.3 of issue #22 tracer-bullet slice — the recorder skill is
// installed only in platform-aware mode. The agnostic recorder template
// doesn't exist yet (lands in slice #29), so listing it for agnostic
// mode would crash setup with a missing-source-file error.

const installSkills = require('../../../scripts/install-skills.js');

describe('skillTemplatesForMode — recorder is aware-only', () => {
  it('platform-aware returns exactly 3 templates including the recorder', () => {
    const templates = installSkills.skillTemplatesForMode('platform-aware');
    expect(templates).toHaveLength(3);
    const recorder = templates.find(t => /mobile-automator-recorder\/aware\/SKILL\.md$/.test(t.src));
    expect(recorder).toBeDefined();
    expect(recorder.dest).toBe('.gemini/skills/mobile-automator-recorder/SKILL.md');
  });

  it('platform-agnostic returns exactly 2 templates with no recorder', () => {
    const templates = installSkills.skillTemplatesForMode('platform-agnostic');
    expect(templates).toHaveLength(2);
    for (const t of templates) {
      expect(t.src).not.toMatch(/recorder/);
      expect(t.dest).not.toMatch(/recorder/);
    }
  });

  it('platform-aware still includes generator and executor templates', () => {
    const templates = installSkills.skillTemplatesForMode('platform-aware');
    const dests = templates.map(t => t.dest);
    expect(dests).toContain('.gemini/skills/mobile-automator-generator/SKILL.md');
    expect(dests).toContain('.gemini/skills/mobile-automator-executor/SKILL.md');
  });
});
