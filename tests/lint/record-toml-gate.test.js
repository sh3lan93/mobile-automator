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

    it('uses a warning (not HALT) when the port file fails to appear within the retry window', () => {
      // Design decision: the sidecar may bind its port slowly on first-run
      // installs / slow disks. Aborting the recording over a transient delay
      // is harsher than necessary. The redesigned step 3 issues a warning and
      // continues to step 4; if the sidecar is truly broken it will eventually
      // surface as a non-zero exit code, which step 5's pre-existing HALT
      // catches.
      const section = getSection20Slice();
      // Extract step 3 in full (from "3.  **Print" until the start of step 4).
      const step3Match = section.match(/\n3\.\s+\*\*[\s\S]+?(?=\n4\.)/);
      expect(step3Match).not.toBeNull();
      const step3 = step3Match[0];
      // Step 3 must NOT contain **HALT.** — port-file timing failures should
      // be a warning that continues to step 4, not an abort.
      expect(step3).not.toMatch(/\*\*HALT\.\*\*/);
      // It must include a warning marker (⚠️ glyph or the word warning/continuing).
      expect(step3).toMatch(/⚠️|warning|continuing/i);
    });

    it('spawns the sidecar in the background so step 3 can poll the port file concurrently', () => {
      // The previous foreground-blocking design meant step 3 could only fire
      // AFTER the sidecar exited, by which point the URL was useless. The
      // redesign spawns in background so the agent can read the port file
      // while the sidecar is still alive and serving the GUI.
      const section = getSection20Slice();
      // Look for explicit background-spawn language somewhere between the
      // section header and the spawn invocation.
      expect(section).toMatch(/background|non[-\s]?blocking|run_in_background|do\s+not\s+block/i);
    });

    it('explicitly waits on the background subprocess before checking exit code', () => {
      // Step 4 must signal that the agent should await the background task's
      // completion before proceeding to step 5 (exit-code handling). The
      // pre-redesign wording ("Wait for the sidecar to exit") was compatible
      // with foreground blocking too — that's what we're moving away from.
      // The new wording must be unambiguous about background semantics.
      const section = getSection20Slice();
      const step4Match = section.match(/\n4\.\s+\*\*[\s\S]+?(?=\n5\.)/);
      expect(step4Match).not.toBeNull();
      const step4 = step4Match[0];
      // One of these terms must appear: "background" (the model), "await"
      // (modern lifecycle primitive), "task notification" / "task complete"
      // (Gemini/Claude Code background-task vocab), or "PID"/"handle" (raw
      // primitive). Plain "wait" alone is not sufficient.
      expect(step4).toMatch(/background|task[\s-]?notif|task\s+complet|\bawait\b|\bPID\b|\bhandle\b/i);
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
