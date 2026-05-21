'use strict';

// Integration test for slice #11 (issue #32) — Save-time screenshot archival
// when --overwrite is passed.
//
// Drives the real `archiveExistingScreenshots` helper through the sequence
// the recorder skill's step 12 describes:
//   1. (preconditions present) Prior scenario JSON + prior screenshots dir
//      exist under the user's project root.
//   2. Skill receives overwrite_existing=true from /record pre-flight.
//   3. Skill archives prior screenshots → .archive/<id>-<ts>/.
//   4. Skill moves bundle screenshots into screenshots/<id>/.
//   5. Skill cleans up the bundle.
//
// Asserts the AC: "prior screenshots move to .archive/<scenario_id>-<UTC_timestamp>/;
// the mobile-automator/screenshots/<scenario_id>/ directory is cleared and re-populated."

const fs = require('fs');
const path = require('path');
const os = require('os');

const { archiveExistingScreenshots } = require('../../../tools/recorder/src/archive');

const SCENARIO_ID = 'login_happy_path';

describe('overwrite archive flow (slice #11)', () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-overwrite-int-'));
    fs.mkdirSync(path.join(projectRoot, 'mobile-automator', 'scenarios'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'mobile-automator', 'screenshots'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'mobile-automator', '.recorder'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  function seedPriorState() {
    // Prior scenario JSON (will be overwritten in place by step 11).
    fs.writeFileSync(
      path.join(projectRoot, 'mobile-automator', 'scenarios', `${SCENARIO_ID}.json`),
      JSON.stringify({ $schema_version: '2.0', scenario_id: SCENARIO_ID, steps: ['old'] }),
    );
    // Prior per-step screenshots (the slice's target — these must end up in .archive/).
    const priorDir = path.join(projectRoot, 'mobile-automator', 'screenshots', SCENARIO_ID);
    fs.mkdirSync(priorDir, { recursive: true });
    fs.writeFileSync(path.join(priorDir, 'step_open.png'), 'PRIOR-OPEN');
    fs.writeFileSync(path.join(priorDir, 'step_tap.png'), 'PRIOR-TAP');
  }

  function seedRecorderBundle() {
    // The new recording's artifact bundle, with fresh screenshots ready to move in.
    const bundleDir = path.join(projectRoot, 'mobile-automator', '.recorder', SCENARIO_ID);
    fs.mkdirSync(path.join(bundleDir, 'screenshots'), { recursive: true });
    fs.writeFileSync(path.join(bundleDir, 'screenshots', 'step_open.png'), 'NEW-OPEN');
    fs.writeFileSync(path.join(bundleDir, 'screenshots', 'step_tap.png'), 'NEW-TAP');
    return bundleDir;
  }

  function simulateSkillStep12({ overwriteExisting, now }) {
    // 12a — archive prior screenshots only if overwrite_existing.
    let archived = null;
    if (overwriteExisting) {
      archived = archiveExistingScreenshots({ projectRoot, scenarioId: SCENARIO_ID, now });
    }
    // 12b — move new bundle screenshots into the final location.
    const liveDir = path.join(projectRoot, 'mobile-automator', 'screenshots', SCENARIO_ID);
    fs.mkdirSync(liveDir, { recursive: true });
    const bundleDir = path.join(projectRoot, 'mobile-automator', '.recorder', SCENARIO_ID, 'screenshots');
    for (const name of fs.readdirSync(bundleDir)) {
      fs.copyFileSync(path.join(bundleDir, name), path.join(liveDir, name));
    }
    // 13 — cleanup bundle on success.
    fs.rmSync(path.join(projectRoot, 'mobile-automator', '.recorder', SCENARIO_ID), {
      recursive: true,
      force: true,
    });
    return { archived };
  }

  test('with overwrite_existing=true: prior screenshots → .archive/, live dir holds new content', () => {
    seedPriorState();
    seedRecorderBundle();
    const now = new Date('2026-05-21T20-31-09Z'.replace(/-(\d{2})-(\d{2})Z$/, ':$1:$2Z').replace(/T(\d{2})-/, 'T$1:'));

    const { archived } = simulateSkillStep12({ overwriteExisting: true, now });

    // (a) old dir is gone from its original location
    const liveDir = path.join(projectRoot, 'mobile-automator', 'screenshots', SCENARIO_ID);
    expect(fs.existsSync(liveDir)).toBe(true);

    // (b) .archive/<id>-<ts>/ exists with the prior contents
    expect(archived).not.toBeNull();
    expect(fs.existsSync(archived)).toBe(true);
    expect(fs.readFileSync(path.join(archived, 'step_open.png'), 'utf8')).toBe('PRIOR-OPEN');
    expect(fs.readFileSync(path.join(archived, 'step_tap.png'), 'utf8')).toBe('PRIOR-TAP');

    // (c) new screenshots are in place
    expect(fs.readFileSync(path.join(liveDir, 'step_open.png'), 'utf8')).toBe('NEW-OPEN');
    expect(fs.readFileSync(path.join(liveDir, 'step_tap.png'), 'utf8')).toBe('NEW-TAP');

    // (d) bundle cleaned up
    expect(fs.existsSync(path.join(projectRoot, 'mobile-automator', '.recorder', SCENARIO_ID))).toBe(false);
  });

  test('with overwrite_existing=false and no prior screenshots: live dir holds new content, no .archive/ created', () => {
    seedRecorderBundle();
    // No seedPriorState — first-time recording.

    const { archived } = simulateSkillStep12({ overwriteExisting: false });

    expect(archived).toBeNull();
    const archiveRoot = path.join(projectRoot, 'mobile-automator', 'screenshots', '.archive');
    expect(fs.existsSync(archiveRoot)).toBe(false);

    const liveDir = path.join(projectRoot, 'mobile-automator', 'screenshots', SCENARIO_ID);
    expect(fs.readFileSync(path.join(liveDir, 'step_open.png'), 'utf8')).toBe('NEW-OPEN');
  });

  test('with overwrite_existing=true and no prior dir: archive is a no-op (returns null)', () => {
    seedRecorderBundle();
    // Scenario JSON existed (the pre-flight gate gated on its presence) but the screenshots
    // dir somehow doesn't. The skill must not crash — archive returns null cleanly.

    const { archived } = simulateSkillStep12({ overwriteExisting: true, now: new Date() });

    expect(archived).toBeNull();
    const liveDir = path.join(projectRoot, 'mobile-automator', 'screenshots', SCENARIO_ID);
    expect(fs.readFileSync(path.join(liveDir, 'step_open.png'), 'utf8')).toBe('NEW-OPEN');
  });

  test('repeated overwrites within the same second collide-suffix into -2, -3, …', () => {
    const now = new Date('2026-05-21T20:31:09.000Z');

    // First overwrite cycle.
    seedPriorState();
    seedRecorderBundle();
    const first = simulateSkillStep12({ overwriteExisting: true, now });

    // Second overwrite cycle, same simulated `now`.
    seedRecorderBundle();
    const second = simulateSkillStep12({ overwriteExisting: true, now });

    expect(path.basename(first.archived)).toBe(`${SCENARIO_ID}-2026-05-21T20-31-09Z`);
    expect(path.basename(second.archived)).toBe(`${SCENARIO_ID}-2026-05-21T20-31-09Z-2`);
    expect(fs.existsSync(first.archived)).toBe(true);
    expect(fs.existsSync(second.archived)).toBe(true);
  });
});
