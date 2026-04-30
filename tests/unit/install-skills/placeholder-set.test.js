// tests/unit/install-skills/placeholder-set.test.js

// We test the exported placeholder-set logic directly. To do this,
// install-skills.js must export at least the helper that returns the
// expected placeholder list per mode. The refactor in Step 4 will
// expose this.

const installSkills = require('../../../scripts/install-skills.js');

describe('placeholder set per mode', () => {
  it('aware mode has 13 placeholders', () => {
    expect(installSkills.placeholderNamesForMode('platform-aware'))
      .toHaveLength(13);
  });

  it('agnostic mode has 6 placeholders', () => {
    expect(installSkills.placeholderNamesForMode('platform-agnostic'))
      .toHaveLength(6);
  });

  it('agnostic placeholders are a strict subset of aware', () => {
    const aware = installSkills.placeholderNamesForMode('platform-aware');
    const agnostic = installSkills.placeholderNamesForMode('platform-agnostic');
    for (const p of agnostic) {
      expect(aware).toContain(p);
    }
  });

  it('agnostic placeholders match the documented 6', () => {
    const agnostic = installSkills.placeholderNamesForMode('platform-agnostic');
    expect(agnostic.sort()).toEqual([
      'additional_resources',
      'business_critical_paths',
      'business_domain',
      'loading_indicators',
      'project_name',
      'protected_directories',
    ].sort());
  });

  it('throws on unknown mode', () => {
    expect(() => installSkills.placeholderNamesForMode('foo')).toThrow();
  });
});
