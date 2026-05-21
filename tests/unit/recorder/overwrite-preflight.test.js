'use strict';

const path = require('path');
const fs = require('fs');
const TOML = require('toml');

const RECORD_TOML = path.resolve(__dirname, '../../../commands/mobile-automator/record.toml');

describe('record.toml — overwrite + verify pre-flight gate (#32)', () => {
  let prompt;
  beforeAll(() => {
    const content = fs.readFileSync(RECORD_TOML, 'utf8');
    TOML.parse(content); // also catches syntax errors
    prompt = content.match(/prompt\s*=\s*"""([\s\S]*?)"""/)[1];
  });

  test('declares a Section 1.4 OVERWRITE GATE between 1.3 and 2.0', () => {
    const i13 = prompt.indexOf('## 1.3 ');
    const i14 = prompt.indexOf('## 1.4 OVERWRITE GATE');
    const i20 = prompt.indexOf('## 2.0 ');
    expect(i13).toBeGreaterThan(-1);
    expect(i14).toBeGreaterThan(i13);
    expect(i20).toBeGreaterThan(i14);
  });

  test('inspects the scenario JSON path only (not the screenshots dir)', () => {
    const section = sliceSection(prompt, '## 1.4 OVERWRITE GATE', '## 2.0 ');
    expect(section).toMatch(/mobile-automator\/scenarios\/<scenario_name>\.json/);
    // Screenshots archival is the skill's job — must not be done here in pre-flight.
    expect(section).not.toMatch(/screenshots\/\.archive/);
  });

  test('aborts with the exact AC-required message when --overwrite is absent', () => {
    const section = sliceSection(prompt, '## 1.4 OVERWRITE GATE', '## 2.0 ');
    expect(section).toContain(
      'Scenario `<scenario_name>` already exists. Pass `--overwrite` to replace, or use a different name.',
    );
    // Followed by an explicit HALT directive.
    expect(section).toMatch(/already exists[\s\S]*?HALT/);
  });

  test('flag is no-op when no prior scenario exists (does not error)', () => {
    const section = sliceSection(prompt, '## 1.4 OVERWRITE GATE', '## 2.0 ');
    expect(section).toMatch(/does not exist[\s\S]*?overwrite_existing\s*=\s*false/);
  });

  test('sets overwrite_existing + verify_on_save booleans for hand-off', () => {
    const section = sliceSection(prompt, '## 1.4 OVERWRITE GATE', '## 2.0 ');
    expect(section).toMatch(/overwrite_existing\s*=\s*true/);
    expect(section).toMatch(/verify_on_save\s*=\s*true/);
  });

  test('Section 3.0 passes overwrite_existing + verify_on_save to the recorder skill', () => {
    const handoff = sliceSection(prompt, '## 3.0 HAND OFF TO RECORDER SKILL', null);
    expect(handoff).toMatch(/overwrite_existing/);
    expect(handoff).toMatch(/verify_on_save/);
    // The executor needs the device for replay; skill must receive it.
    expect(handoff).toMatch(/device/i);
  });

  test('flag declarations in Section 0.1 still document both flags', () => {
    const args = sliceSection(prompt, '## 0.1 ARGUMENT PARSING', '## 0.5 ');
    expect(args).toMatch(/--overwrite/);
    expect(args).toMatch(/--verify/);
  });
});

function sliceSection(text, startHeader, endHeader) {
  const start = text.indexOf(startHeader);
  if (start === -1) throw new Error(`section not found: ${startHeader}`);
  const end = endHeader ? text.indexOf(endHeader, start + startHeader.length) : text.length;
  return text.slice(start, end === -1 ? text.length : end);
}
