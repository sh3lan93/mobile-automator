'use strict';

// Build-time guard over the showcase app's scenarios (#305, PRD #304).
//
// The showcase exists to show mauto driving a real cross-platform app by what
// a person sees, so its scenarios must stay replayable as written, in
// platform-agnostic terms, and the app must not quietly grow the UI-test
// tooling mauto is the alternative to. Each rule below makes one of those
// regressions a build failure:
//
//   1. at least one scenario exists, so the per-file rules are not vacuous;
//   2. every scenario passes the CLI's own schema validation and has no
//      finding `mauto validate --strict` would fail on;
//   3. every scenario is schema 2.1, platform-agnostic and cross-platform,
//      uses only mechanical assertion types, and names no OS element id;
//   4. every scenario launches the id both platforms build, and the Android
//      applicationId and iOS bundle id are the same string;
//   5. no scenario target or expected value is a Compose testTag literal;
//   6. the showcase declares no UI test dependency or UI test source set.

const fs = require('fs');
const path = require('path');

const { REPO_ROOT, repoFiles } = require('./docs-corpus');
const { OS_ID_TOKEN, targetValues } = require('./scenario-targets');
const { ScenarioValidator } = require('../../src/scenario/validator');
const { findReplayWarnings, isBlocking } = require('../../src/scenario/replayability');
const { MECHANICAL_TYPES } = require('../../src/assertion/evaluator');

const APP = 'showcase-app';
const SCENARIOS = `${APP}/scenarios/`;
const ANDROID_GRADLE = `${APP}/androidApp/build.gradle.kts`;
const IOS_XCCONFIG = `${APP}/iosApp/Configuration/Config.xcconfig`;
const APP_SOURCE = `${APP}/shared/src/`;

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// Every file git knows under showcase-app/ (tracked plus not-yet-staged, minus
// ignored build output and the git-ignored key file).
const appFiles = repoFiles(APP);
const scenarioFiles = appFiles.filter((f) => f.startsWith(SCENARIOS) && f.endsWith('.json'));

function androidApplicationId() {
  const m = read(ANDROID_GRADLE).match(/applicationId\s*=\s*"([^"]+)"/);
  return m ? m[1] : null;
}

function iosBundleId() {
  const m = read(IOS_XCCONFIG).match(/^\s*BUNDLE_ID\s*=\s*(\S+)\s*$/m);
  return m ? m[1] : null;
}

describe('showcase scenarios — present', () => {
  test('showcase-app/scenarios holds at least one scenario (the rules below are not vacuous)', () => {
    expect(scenarioFiles.length).toBeGreaterThan(0);
  });
});

describe('showcase app id — one id for both platforms', () => {
  test('the Android applicationId and the iOS bundle id are the same string', () => {
    const android = androidApplicationId();
    expect(android).toEqual(expect.any(String));
    expect(iosBundleId()).toBe(android);
  });
});

const validator = new ScenarioValidator();

for (const file of scenarioFiles) describe(file, () => {
  const raw = read(file);
  const scenario = JSON.parse(raw);

  test('passes schema validation', () => {
    const { valid, errors } = validator.validate(scenario);
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  test('has no finding that would fail validate --strict', () => {
    expect(findReplayWarnings(scenario).filter(isBlocking)).toEqual([]);
  });

  test('is schema 2.1, platform-agnostic and cross-platform', () => {
    expect({
      $schema_version: scenario.$schema_version,
      mode: scenario.mode,
      platform: scenario.platform,
    }).toEqual({ $schema_version: '2.1', mode: 'platform-agnostic', platform: 'cross-platform' });
  });

  test('uses only mechanical assertion types', () => {
    const offenders = (scenario.assertions || [])
      .filter((a) => !MECHANICAL_TYPES.has(a.type))
      .map((a) => `${a.id}: ${a.type}`);
    expect(offenders).toEqual([]);
  });

  test('names no OS element id', () => {
    const offenders = raw
      .split('\n')
      .map((line, i) => [line, i + 1])
      .filter(([line]) => OS_ID_TOKEN.test(line))
      .map(([line, n]) => `${file}:${n}: ${line.trim()}`);
    expect(offenders).toEqual([]);
  });

  test('launches the app id both platforms build', () => {
    expect(scenario.app_package).toBe(androidApplicationId());
    expect(scenario.app_package).toBe(iosBundleId());
  });
});

// Every `testTag("…")` literal in the app source. A testTag reaches the device
// as an OS element id, which a scenario must never target.
function testTags() {
  const tags = new Set();
  for (const file of appFiles.filter((f) => f.startsWith(APP_SOURCE) && f.endsWith('.kt'))) {
    for (const m of read(file).matchAll(/testTag\(\s*"([^"]+)"\s*\)/g)) tags.add(m[1]);
  }
  return tags;
}

describe('showcase scenarios — on-screen strings, not testTags', () => {
  // Zero tags in the app is the expected state and passes.
  test('no scenario target or expected value equals a testTag literal in the app source', () => {
    const tags = testTags();
    const offenders = [];
    for (const file of scenarioFiles) {
      for (const { where, value } of targetValues(JSON.parse(read(file)))) {
        if (tags.has(value)) offenders.push(`${file} ${where}: ${JSON.stringify(value)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('showcase app — no UI test tooling', () => {
  const UI_TEST_DEP = /espresso|androidx\.test|ui-test|uiTest|XCUITest/i;
  const UI_TEST_DIR = (segment) =>
    segment === 'androidTest' || segment === 'androidInstrumentedTest' || segment.endsWith('UITests');

  test('the build files exist (the rule below is not vacuous)', () => {
    expect(appFiles).toEqual(expect.arrayContaining([ANDROID_GRADLE, `${APP}/gradle/libs.versions.toml`]));
  });

  test('the showcase declares no UI test dependency', () => {
    const buildFiles = appFiles.filter((f) => f.endsWith('.gradle.kts') || f === `${APP}/gradle/libs.versions.toml`);
    const offenders = [];
    for (const file of buildFiles) {
      read(file).split('\n').forEach((line, i) => {
        if (UI_TEST_DEP.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    const dirs = appFiles.filter((f) => f.split('/').slice(0, -1).some(UI_TEST_DIR));
    expect({ offenders, dirs }).toEqual({ offenders: [], dirs: [] });
  });
});
