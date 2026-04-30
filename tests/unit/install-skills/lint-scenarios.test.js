// tests/unit/install-skills/lint-scenarios.test.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { lintScenariosForAgnostic } = require('../../../scripts/install-skills.js');

const FIXTURES = path.resolve(__dirname, '..', '..', 'fixtures', 'scenarios');

function copyFixtures(workspace, fileNames) {
  const target = path.join(workspace, 'mobile-automator', 'scenarios');
  fs.mkdirSync(target, { recursive: true });
  for (const f of fileNames) {
    fs.copyFileSync(path.join(FIXTURES, f), path.join(target, f));
  }
}

describe('lintScenariosForAgnostic', () => {
  it('flags press_button("BACK") with a suggestion to use press_back', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-sc-'));
    copyFixtures(dir, ['scenario-with-back.json']);

    const findings = lintScenariosForAgnostic(
      path.join(dir, 'mobile-automator', 'scenarios')
    );

    expect(findings.length).toBe(1);
    expect(findings[0].file).toMatch(/scenario-with-back\.json$/);
    expect(findings[0].finding).toMatch(/press_button.*BACK/);
    expect(findings[0].suggestion).toMatch(/press_back/);
  });

  it('returns no findings for a platform-neutral scenario', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-sc-'));
    copyFixtures(dir, ['scenario-clean.json']);

    const findings = lintScenariosForAgnostic(
      path.join(dir, 'mobile-automator', 'scenarios')
    );

    expect(findings).toEqual([]);
  });

  it('handles missing scenarios directory gracefully', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-sc-'));
    const findings = lintScenariosForAgnostic(
      path.join(dir, 'mobile-automator', 'scenarios')
    );
    expect(findings).toEqual([]);
  });
});
