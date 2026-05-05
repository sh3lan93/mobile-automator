const fs = require('fs');
const path = require('path');
const TOML = require('toml');

const RECORD_TOML_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'commands',
  'mobile-automator',
  'record.toml'
);

function loadRecordToml() {
  const content = fs.readFileSync(RECORD_TOML_PATH, 'utf8');
  const parsed = TOML.parse(content);
  const prompt =
    content.match(/prompt\s*=\s*"""([\s\S]*?)"""/)?.[1] || parsed.prompt || '';
  return { content, parsed, prompt };
}

describe('record.toml experimental gate', () => {
  let record;

  beforeAll(() => {
    record = loadRecordToml();
  });

  it('exists at commands/mobile-automator/record.toml', () => {
    expect(fs.existsSync(RECORD_TOML_PATH)).toBe(true);
  });

  it('mentions the MOBILE_AUTOMATOR_RECORDER environment variable', () => {
    expect(record.prompt).toContain('MOBILE_AUTOMATOR_RECORDER');
  });

  it('references issue #21 so users can track the experimental status', () => {
    // Accept either "#21" inline or a link containing "issues/21"
    const hasHashRef = /#21\b/.test(record.prompt);
    const hasUrlRef = /issues\/21\b/.test(record.prompt);
    expect(hasHashRef || hasUrlRef).toBe(true);
  });

  it("uses the project's HALT pattern (bold **HALT.**) inside the gate", () => {
    // The gate must be the FIRST HALT-bearing block. Find the position of the
    // first "MOBILE_AUTOMATOR_RECORDER" mention and assert a **HALT.** appears
    // shortly after (i.e. the gate halts cleanly when the env var is absent).
    const gateIdx = record.prompt.indexOf('MOBILE_AUTOMATOR_RECORDER');
    expect(gateIdx).toBeGreaterThanOrEqual(0);
    const slice = record.prompt.slice(gateIdx, gateIdx + 1500);
    expect(slice).toMatch(/\*\*HALT\.\*\*/);
  });

  it('places the gate before any pre-flight check (before Section 1.0)', () => {
    const gateIdx = record.prompt.indexOf('MOBILE_AUTOMATOR_RECORDER');
    const preflightIdx = record.prompt.search(/^##\s+1\.0\b/m);
    // Both must exist, and gate must come first.
    expect(gateIdx).toBeGreaterThanOrEqual(0);
    expect(preflightIdx).toBeGreaterThanOrEqual(0);
    expect(gateIdx).toBeLessThan(preflightIdx);
  });
});
