// tests/lint/agnostic-no-platform-words.test.js
const fs = require('fs');
const path = require('path');

const TEMPLATES = [
  'mobile-automator-generator/agnostic/SKILL.md',
  'mobile-automator-executor/agnostic/SKILL.md',
];

const FORBIDDEN = [
  /\bAndroid\b/i,
  /\biOS\b/i,
  /\bFlutter\b/i,
  /\bReact[ -]?Native\b/i,
  /\bKotlin\b/i,
  /\bCompose\b/i,
];

// The single allowed line: the executor's pointer to platform-resolutions.md.
// Hard-coded so accidental drift fails CI.
const ALLOWED_LINES = new Set([
  'When you encounter a semantic action (`press_back`, `dismiss_keyboard`, `grant_permission`, `deny_permission`), look it up in `.gemini/skills/references/platform-resolutions.md` and execute the resolution that matches the connected device\'s `platform` field returned by `mobile_list_available_devices()`.',
]);

describe('Agnostic templates contain no per-OS prose', () => {
  for (const tmpl of TEMPLATES) {
    describe(tmpl, () => {
      const filePath = path.resolve(
        __dirname, '..', '..', 'templates', tmpl
      );

      it('exists', () => {
        expect(fs.existsSync(filePath)).toBe(true);
      });

      it('contains no forbidden platform words', () => {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        const violations = [];
        lines.forEach((line, idx) => {
          if (ALLOWED_LINES.has(line.trim())) return;
          for (const pattern of FORBIDDEN) {
            if (pattern.test(line)) {
              violations.push({ line: idx + 1, text: line, pattern: pattern.toString() });
            }
          }
        });
        expect(violations).toEqual([]);
      });
    });
  }
});
