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

  it('pre-flight checks for ffmpeg and provides at least one install command', () => {
    // The recorder sidecar shells out to ffmpeg to extract frames from
    // the screen recording. Without it, no taps can be detected, so the
    // command must halt cleanly with install guidance instead of
    // crashing mid-session with `spawn ffmpeg ENOENT`.
    expect(record.prompt).toMatch(/\bffmpeg\b/);

    // At least one platform-specific install command must appear so the
    // halt message is actionable. Accept brew, apt, pacman, or a link to
    // ffmpeg.org/download.
    const installPatterns = [
      /brew install ffmpeg/,
      /apt(-get)?\s+install\s+ffmpeg/,
      /pacman\s+-S\s+ffmpeg/,
      /ffmpeg\.org\/download/,
    ];
    const hasAnyInstallHint = installPatterns.some((p) => p.test(record.prompt));
    expect(hasAnyInstallHint).toBe(true);
  });

  it('places the ffmpeg check before the sidecar is spawned (before Section 2.0)', () => {
    const ffmpegIdx = record.prompt.indexOf('ffmpeg');
    const sidecarIdx = record.prompt.search(/^##\s+2\.0\b/m);
    expect(ffmpegIdx).toBeGreaterThanOrEqual(0);
    expect(sidecarIdx).toBeGreaterThanOrEqual(0);
    expect(ffmpegIdx).toBeLessThan(sidecarIdx);
  });

  describe('GUI URL fallback (issue #66)', () => {
    // After spawning the sidecar, the command must read the port file the
    // sidecar writes and print the GUI URL so the user has a fallback when
    // browser auto-open fails or isn't desired (SSH, CI, closed tab).

    function getSection20Slice() {
      const startIdx = record.prompt.search(/^##\s+2\.0\b/m);
      const endIdx = record.prompt.search(/^##\s+3\.0\b/m);
      expect(startIdx).toBeGreaterThanOrEqual(0);
      expect(endIdx).toBeGreaterThan(startIdx);
      return record.prompt.slice(startIdx, endIdx);
    }

    it('references the recorder.port file in Section 2.0', () => {
      const section = getSection20Slice();
      expect(section).toMatch(/recorder\.port/);
    });

    it("contains the literal 'Recorder GUI:' label in Section 2.0", () => {
      const section = getSection20Slice();
      expect(section).toContain('Recorder GUI:');
    });

    it('has a **HALT.** block tied to the port-file-missing failure mode in Section 2.0', () => {
      const section = getSection20Slice();
      // Find a HALT block whose surrounding text mentions recorder.port or "port file"
      // so we know the HALT is tied to the missing-port-file failure, not the
      // pre-existing non-zero-exit HALT.
      const haltIndices = [];
      const haltRegex = /\*\*HALT\.\*\*/g;
      let m;
      while ((m = haltRegex.exec(section)) !== null) {
        haltIndices.push(m.index);
      }
      expect(haltIndices.length).toBeGreaterThan(0);

      const tiedToPortFile = haltIndices.some((idx) => {
        // Look at the 800 chars preceding the HALT for a port-file reference.
        const context = section.slice(Math.max(0, idx - 800), idx);
        return /recorder\.port/.test(context) || /port file/i.test(context);
      });
      expect(tiedToPortFile).toBe(true);
    });

    it('places the GUI URL print AFTER the sidecar spawn and BEFORE Section 3.0', () => {
      const spawnIdx = record.prompt.indexOf(
        'node ${extensionPath}/tools/recorder/src/index.js'
      );
      const guiLabelIdx = record.prompt.indexOf('Recorder GUI:');
      const handoffIdx = record.prompt.search(/^##\s+3\.0\b/m);

      expect(spawnIdx).toBeGreaterThanOrEqual(0);
      expect(guiLabelIdx).toBeGreaterThanOrEqual(0);
      expect(handoffIdx).toBeGreaterThanOrEqual(0);

      expect(guiLabelIdx).toBeGreaterThan(spawnIdx);
      expect(guiLabelIdx).toBeLessThan(handoffIdx);
    });
  });
});
