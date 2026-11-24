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
//   2. every scenario passes `mauto validate --strict`, through the same
//      loader (`src/scenario/load.js`) the CLI and `mauto run` use;
//   3. every scenario is schema 2.1, platform-agnostic and cross-platform,
//      uses only mechanical assertion types, and names no OS element id;
//   4. every scenario launches the id both platforms build, and the Android
//      applicationId and iOS bundle id are the same string;
//   5. no scenario target or expected value is a Compose testTag literal;
//   6. no target, expected value or pattern after a `type` step matches the
//      text typed before it (see typedTextOffenders);
//   7. the showcase declares no UI test dependency or UI test source set.

const fs = require('fs');
const path = require('path');

const { REPO_ROOT, repoFiles } = require('./docs-corpus');
const { OS_ID_TOKEN, targetValues, patternValues } = require('./scenario-targets');
const { ScenarioValidator } = require('../../src/scenario/validator');
const { loadScenario } = require('../../src/scenario/load');
const { flattenSteps } = require('../../src/scenario/steps');
const { MECHANICAL_TYPES, matches } = require('../../src/assertion/evaluator');

const APP = 'showcase-app';
const SCENARIOS = `${APP}/scenarios/`;
const ANDROID_GRADLE = `${APP}/androidApp/build.gradle.kts`;
const IOS_XCCONFIG = `${APP}/iosApp/Configuration/Config.xcconfig`;
const IOS_PBXPROJ = `${APP}/iosApp/iosApp.xcodeproj/project.pbxproj`;
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

// The bundle id the iOS build actually produces: every PRODUCT_BUNDLE_IDENTIFIER
// in the project, with its ${VAR} / $(VAR) references filled from
// Config.xcconfig's KEY=VALUE lines. All build configurations must resolve to
// one id; anything else (no setting, or two different ids) returns null.
function iosBundleId() {
  const vars = {};
  for (const m of read(IOS_XCCONFIG).matchAll(/^[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*(.*?)[ \t]*$/gm)) vars[m[1]] = m[2];
  const values = [...read(IOS_PBXPROJ).matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*("(?:[^"\\]|\\.)*"|[^;\s]+)\s*;/g)]
    .map((m) => m[1].replace(/^"(.*)"$/, '$1'))
    .map((v) => v.replace(/\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|\(([A-Za-z_][A-Za-z0-9_]*)\))/g, (_, a, b) => vars[a || b] ?? ''));
  const ids = new Set(values);
  return ids.size === 1 ? [...ids][0] : null;
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

  // The exact path `mauto validate --strict` and `mauto run` take: one call to
  // the shared loader, so a new strict-mode rule reaches this guard unrestated.
  test('passes mauto validate --strict', () => {
    const { failure } = loadScenario(validator, path.join(REPO_ROOT, file), { projectRoot: REPO_ROOT, strict: true });
    expect(failure && failure.envelope).toBeUndefined();
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

// The CLI matches a target against an element's text or label (`matches`),
// and a regex field (`target_pattern`, `pattern`) by testing it
// against the element's text. Android exposes a text field's typed text as the
// field's text while iOS does not, so a target the typed text contains, or a
// pattern the typed text matches, would hit the text field itself on Android
// only: the step or assertion passes there without the effect of typing ever
// appearing, and fails on iOS. So nothing positioned after a `type` step (a
// later step, or an assertion whose `after_step` is that step or later) may
// match a value typed earlier. Returns one line per offending value.
//
// Step order is `flattenSteps`' (depth-first, sub_steps included), the same
// order every other step-order check reads. A value anchored to a step id the
// walk does not know cannot be placed, so it is reported, not skipped.
function typedTextOffenders(scenario) {
  const steps = flattenSteps(scenario).map(({ step }) => step);
  const order = new Map(steps.map((s, i) => [s.id, i]));
  const typed = steps
    .map((s, i) => ({ i, id: s.id, action: s.action, value: s.value }))
    .filter((t) => t.action === 'type' && typeof t.value === 'string' && t.value.trim() !== '');
  // Targets go through the CLI's own matcher (`matches`, the one
  // src/run/resolve.js is given), against an element whose text is what was
  // typed: exactly what the Android text field shows. Patterns are compiled as
  // the runner and the evaluator compile them. `matches` treats an empty
  // target as matching everything, which is right for an assertion scope and
  // meaningless here, so empty values are skipped.
  const values = [
    ...targetValues(scenario).map((v) => ({ ...v, verb: 'is matched by', hits: (text) => matches({ text }, v.value) })),
    ...patternValues(scenario).map((v) => ({ ...v, verb: 'matches', hits: (text) => new RegExp(v.value).test(text) })),
  ];
  const offenders = [];
  for (const { where, value, kind, step, verb, hits } of values) {
    const at = order.get(step);
    if (at === undefined) {
      offenders.push(`${where}: anchored to step ${JSON.stringify(step)}, which the scenario does not have`);
      continue;
    }
    if (value === '') continue;
    // A step runs after type steps before it; an assertion runs after its
    // after_step, so a type step at that same index is already done.
    for (const t of typed.filter((earlier) => (kind === 'assertion' ? earlier.i <= at : earlier.i < at))) {
      if (hits(t.value)) {
        offenders.push(`${where}: ${JSON.stringify(value)} ${verb} the text typed by step ${t.id} (${JSON.stringify(t.value)})`);
      }
    }
  }
  return offenders;
}

describe('showcase scenarios — the effect of typing, never the typed text', () => {
  test('no target, expected value or pattern after a type step matches text typed before it', () => {
    const offenders = scenarioFiles.flatMap((file) =>
      typedTextOffenders(JSON.parse(read(file))).map((line) => `${file} ${line}`));
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
