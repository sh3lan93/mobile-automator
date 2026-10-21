'use strict';

// The sample-app scenarios the real-device E2E runs, checked against the
// schema and against the probe screens captured from a real device. The
// device run is the real test; this catches a target that cannot possibly
// resolve, or resolves to the wrong element, before a 10-minute emulator job.

const fs = require('fs');
const path = require('path');

const evaluator = require('../../../src/assertion/evaluator');
const { ScenarioValidator } = require('../../../src/scenario/validator');
const { resolveTarget } = require('../../../sample-app/scripts/lib/resolve');
const { SEMANTIC_ACTIONS } = require('../../../sample-app/scripts/lib/executor');
const { homeElements, moreElements } = require('./fixtures');

const SCENARIOS = path.join(__dirname, '..', '..', '..', 'sample-app', 'scenarios');
const GOLDEN_DIR = path.join(SCENARIOS, 'golden');
const load = (name) => JSON.parse(fs.readFileSync(path.join(SCENARIOS, name), 'utf8'));
const HARNESS_ACTIONS = new Set(['launch_app', 'wait_for_element', 'tap', 'type', ...SEMANTIC_ACTIONS]);
const OS_ID_SHAPE = /^[a-z0-9]+(_[a-z0-9]+)+$/; // e.g. bottom_nav_home

// Every scenario in scenarios/ is pre-flighted here, discovered the same way
// the runner (run-e2e.mjs) and the lint guard (e2e-agnostic.test.js) discover
// them — readdirSync — so a new scenario cannot reach the 10-minute emulator
// job, or silently skip an assertion (an `after_step` matching no step is
// never run, and the run passes), without passing these checks first.
const scenarioFiles = fs
  .readdirSync(SCENARIOS)
  .filter((f) => f.endsWith('.json'))
  .map((f) => path.basename(f));

describe('scenario discovery', () => {
  test('finds the shipped scenarios (the per-scenario checks below are not vacuous)', () => {
    expect(scenarioFiles).toEqual(expect.arrayContaining(['smoke_nav.json', 'golden_search_empty.json']));
  });
});

describe.each(scenarioFiles)('%s', (file) => {
  const sc = load(file);

  test('is a valid 2.1 platform-agnostic scenario', () => {
    expect(new ScenarioValidator().validate(sc)).toEqual({ valid: true, errors: [] });
    expect(sc.$schema_version).toBe('2.1');
    expect(sc.mode).toBe('platform-agnostic');
  });

  test('uses only actions the harness executes', () => {
    for (const step of sc.steps) expect(HARNESS_ACTIONS.has(step.action)).toBe(true);
  });

  test('targets are on-screen strings, not OS element ids', () => {
    const targets = [
      ...sc.steps.map((s) => s.target),
      ...sc.assertions.map((a) => a.element_description),
    ].filter(Boolean);
    for (const t of targets) expect(t).not.toMatch(OS_ID_SHAPE);
  });

  test('every assertion follows a real step', () => {
    const ids = new Set(sc.steps.map((s) => s.id));
    for (const a of sc.assertions) expect(ids.has(a.after_step)).toBe(true);
  });

  test('is tagged golden if and only if a golden fixture exists for it', () => {
    // The golden gate (lib/golden.js) is the `golden` tag, loud in both
    // directions; the shipped data must agree with itself.
    const tagged = (sc.tags || []).includes('golden');
    const fixture = path.join(GOLDEN_DIR, `${sc.scenario_id}.result.json`);
    expect(fs.existsSync(fixture)).toBe(tagged);
  });
});

describe('smoke_nav against the probe screens', () => {
  const sc = load('smoke_nav.json');
  const target = (id) => sc.steps.find((s) => s.id === id).target;

  test('"Home" alone would hit the leaked "Home & Kitchen" tile (#251), which is why the Home tab is targeted by its tab label', () => {
    expect(resolveTarget(moreElements(), 'Home', evaluator).element.text).toBe('Home & Kitchen');
    expect(resolveTarget(moreElements(), target('tap_home'), evaluator).element.accessibility_label).toMatch(/^Home\nTab 1 of 3/);
  });

  test('"More" from Home and "Categories" from More resolve to their nav items', () => {
    expect(resolveTarget(homeElements(), target('tap_more'), evaluator).element.accessibility_label).toMatch(/^More\nTab 3 of 3/);
    expect(resolveTarget(moreElements(), target('tap_categories'), evaluator).element.accessibility_label).toMatch(/^Categories\nTab 2 of 3/);
  });

  test('the header assertions discriminate the active tab', () => {
    const a = (id) => sc.assertions.find((x) => x.id === id);
    const check = (assertion, elements) =>
      evaluator.evaluate(
        { type: assertion.type, target: assertion.element_description, expected: assertion.expected_value },
        { elements }
      ).pass;
    // On More, the header is found before the nav label and reads exactly "More".
    expect(check(a('more_tab_active'), moreElements())).toBe(true);
    // On Home, the only "More" is the nav label, so the same assertion fails.
    expect(check(a('more_tab_active'), homeElements())).toBe(false);
    expect(check(a('home_tab_active'), homeElements())).toBe(true);
    expect(check(a('home_tab_active'), moreElements())).toBe(false);
  });
});
