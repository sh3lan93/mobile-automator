'use strict';

const fs = require('fs');
const path = require('path');

const MODES = ['aware', 'agnostic'];
const SKILL_PATH = (mode) =>
  path.resolve(__dirname, '..', '..', 'templates', 'mobile-automator-recorder', mode, 'SKILL.md');

describe('recorder skill templates — overwrite + verify (#32)', () => {
  MODES.forEach((mode) => {
    describe(`${mode} mode SKILL.md`, () => {
      let content;
      beforeAll(() => {
        content = fs.readFileSync(SKILL_PATH(mode), 'utf8');
      });

      test('documents overwrite_existing + verify_on_save in the inputs section', () => {
        expect(content).toMatch(/overwrite_existing/);
        expect(content).toMatch(/verify_on_save/);
        expect(content).toMatch(/Pre-flight values from `\/mobile-automator:record`/);
      });

      test('step 12 has an archive-prior-screenshots sub-step gated on overwrite_existing', () => {
        // step 12 (Move screenshots) must precede step 13 (Cleanup) — the section between them
        // is what we lint here.
        const step12 = content.indexOf('12. **Move screenshots.');
        const step13 = content.indexOf('13. **Cleanup');
        expect(step12).toBeGreaterThan(-1);
        expect(step13).toBeGreaterThan(step12);
        const block = content.slice(step12, step13);
        expect(block).toMatch(/12a\.\s+Archive prior screenshots/);
        expect(block).toMatch(/overwrite_existing\s*=\s*true/);
        expect(block).toMatch(/mobile-automator\/screenshots\/\.archive/);
        // Timestamp format guidance must specify colon/dot stripping.
        expect(block).toMatch(/colons.*?dots.*?replaced by `-`/);
      });

      test('step 15 verify is opt-in and preserves the JSON on FAIL', () => {
        const step15 = content.indexOf('15. **Verify');
        expect(step15).toBeGreaterThan(-1);
        const block = content.slice(step15);
        expect(block).toMatch(/verify_on_save\s*=\s*true/);
        expect(block).toMatch(/Default behavior is no replay/);
        expect(block).toMatch(/mobile-automator-executor\/SKILL\.md/);
        // FAIL branch must explicitly preserve the JSON.
        expect(block).toMatch(/FAIL[\s\S]*?preserved/);
        expect(block).toMatch(/NOT delete the scenario JSON/);
      });
    });
  });

  test('aware and agnostic step 12 archive sub-steps describe the same algorithm', () => {
    const aware = fs.readFileSync(SKILL_PATH('aware'), 'utf8');
    const agn = fs.readFileSync(SKILL_PATH('agnostic'), 'utf8');
    const slice = (s) => {
      const start = s.indexOf('**12a.');
      const end = s.indexOf('**12b.', start);
      return s.slice(start, end);
    };
    expect(slice(aware)).toBe(slice(agn));
  });

  test('aware and agnostic step 15 verify blocks describe the same algorithm', () => {
    const aware = fs.readFileSync(SKILL_PATH('aware'), 'utf8');
    const agn = fs.readFileSync(SKILL_PATH('agnostic'), 'utf8');
    const slice = (s) => {
      const start = s.indexOf('15. **Verify');
      const end = s.indexOf('## ', start);
      return s.slice(start, end);
    };
    // Bodies legitimately differ on per-mode details (e.g., the agnostic block calls out
    // the platform-resolutions layer that aware mode doesn't have, and the schema version).
    // Assert structural overlap on the load-bearing lines instead of a strict ratio.
    const a = slice(aware).split('\n').filter(Boolean);
    const b = slice(agn).split('\n').filter(Boolean);
    const shared = a.filter((line) => b.includes(line)).length;
    expect(shared / Math.max(a.length, b.length)).toBeGreaterThan(0.8);
  });
});
