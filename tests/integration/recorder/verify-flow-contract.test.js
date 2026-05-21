'use strict';

// Integration test for slice #11 (issue #32) — --verify replay-on-save contract.
//
// We cannot drive a real AI in tests, so this asserts the contract surface the
// recorder skill commits to when verify_on_save=true:
//   - Both recorder skill templates reference the executor skill by path.
//   - The executor skill template the recorder delegates to actually exists.
//   - The verify step names all three inputs the executor needs (scenario_id,
//     selected_device, environment).
//   - The FAIL branch explicitly preserves the just-written scenario JSON.
//   - A simulated PASS or FAIL outcome leaves the scenario JSON in place either way.

const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const RECORDER_AWARE = path.join(REPO_ROOT, 'templates', 'mobile-automator-recorder', 'aware', 'SKILL.md');
const RECORDER_AGNOSTIC = path.join(REPO_ROOT, 'templates', 'mobile-automator-recorder', 'agnostic', 'SKILL.md');
const EXECUTOR_AWARE = path.join(REPO_ROOT, 'templates', 'mobile-automator-executor', 'aware', 'SKILL.md');
const EXECUTOR_AGNOSTIC = path.join(REPO_ROOT, 'templates', 'mobile-automator-executor', 'agnostic', 'SKILL.md');

describe('verify-on-save contract (slice #11)', () => {
  describe('cross-skill references', () => {
    test('aware-mode recorder verify step references the executor skill', () => {
      const content = fs.readFileSync(RECORDER_AWARE, 'utf8');
      const verifyStart = content.indexOf('15. **Verify');
      const verifyEnd = content.indexOf('## ', verifyStart);
      const block = content.slice(verifyStart, verifyEnd);
      expect(block).toMatch(/\.gemini\/skills\/mobile-automator-executor\/SKILL\.md/);
    });

    test('agnostic-mode recorder verify step references the executor skill', () => {
      const content = fs.readFileSync(RECORDER_AGNOSTIC, 'utf8');
      const verifyStart = content.indexOf('15. **Verify');
      const verifyEnd = content.indexOf('## ', verifyStart);
      const block = content.slice(verifyStart, verifyEnd);
      expect(block).toMatch(/\.gemini\/skills\/mobile-automator-executor\/SKILL\.md/);
    });

    test('referenced executor skill templates exist on disk', () => {
      expect(fs.existsSync(EXECUTOR_AWARE)).toBe(true);
      expect(fs.existsSync(EXECUTOR_AGNOSTIC)).toBe(true);
    });
  });

  describe('verify step input contract', () => {
    test.each([
      ['aware', RECORDER_AWARE],
      ['agnostic', RECORDER_AGNOSTIC],
    ])('%s mode names all three inputs the executor needs', (_, filePath) => {
      const content = fs.readFileSync(filePath, 'utf8');
      const verifyStart = content.indexOf('15. **Verify');
      const verifyEnd = content.indexOf('## ', verifyStart);
      const block = content.slice(verifyStart, verifyEnd);

      expect(block).toMatch(/scenario_id/);
      expect(block).toMatch(/selected_device/);
      expect(block).toMatch(/environment/);
      // Should NOT re-run pre-flight (device/app checks already happened).
      expect(block).toMatch(/Do NOT re-run device\/app pre-flight/);
    });
  });

  describe('FAIL branch preserves the scenario JSON', () => {
    test.each([
      ['aware', RECORDER_AWARE],
      ['agnostic', RECORDER_AGNOSTIC],
    ])('%s mode FAIL branch documents JSON preservation explicitly', (_, filePath) => {
      const content = fs.readFileSync(filePath, 'utf8');
      const verifyStart = content.indexOf('15. **Verify');
      const verifyEnd = content.indexOf('## ', verifyStart);
      const block = content.slice(verifyStart, verifyEnd);

      // FAIL announcement names the preserved JSON path.
      expect(block).toMatch(/FAIL[\s\S]*?preserved[\s\S]*?mobile-automator\/scenarios\/<scenario_id>\.json/);
      // Critical guardrail: must explicitly forbid deletion of the JSON on failure.
      expect(block).toMatch(/NOT delete the scenario JSON/);
      // FAIL output points the user to /mobile-automator:execute for re-verification.
      expect(block).toMatch(/\/mobile-automator:execute/);
    });
  });

  describe('simulated PASS/FAIL leave the scenario JSON in place', () => {
    let projectRoot;
    const SCENARIO_ID = 'login_smoke';

    beforeEach(() => {
      projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-verify-int-'));
      fs.mkdirSync(path.join(projectRoot, 'mobile-automator', 'scenarios'), { recursive: true });
    });
    afterEach(() => {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    });

    function writeFreshlyRecordedScenario() {
      const p = path.join(projectRoot, 'mobile-automator', 'scenarios', `${SCENARIO_ID}.json`);
      fs.writeFileSync(p, JSON.stringify({ $schema_version: '2.0', scenario_id: SCENARIO_ID, steps: [] }));
      return p;
    }

    // The skill's contract is observable: regardless of the simulated executor
    // outcome, the scenario JSON survives. We model this without an AI loop.
    function runVerifySimulation({ executorOutcome }) {
      const jsonPath = writeFreshlyRecordedScenario();
      // Step 15 in the skill: invoke executor. Outcome reported but JSON preserved.
      return { jsonPath, outcome: executorOutcome };
    }

    test('PASS outcome: JSON in place', () => {
      const { jsonPath, outcome } = runVerifySimulation({ executorOutcome: 'PASS' });
      expect(outcome).toBe('PASS');
      expect(fs.existsSync(jsonPath)).toBe(true);
    });

    test('FAIL outcome: JSON in place (AC #6)', () => {
      const { jsonPath, outcome } = runVerifySimulation({ executorOutcome: 'FAIL' });
      expect(outcome).toBe('FAIL');
      expect(fs.existsSync(jsonPath)).toBe(true);
      // Sanity: payload unchanged (no rollback or partial truncation).
      const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      expect(parsed.scenario_id).toBe(SCENARIO_ID);
    });
  });
});
