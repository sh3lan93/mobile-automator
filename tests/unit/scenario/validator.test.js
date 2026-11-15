'use strict';

const path = require('path');
const { ScenarioValidator } = require('../../../src/scenario/validator');

const SCHEMA_PATH = path.resolve(
  __dirname,
  '../../../src/schemas/scenario_schema.json'
);

// Minimal schema-conformant scenario built from the schema `required` fields.
function validScenario() {
  return {
    $schema_version: '2.1',
    scenario_id: 'login_smoke',
    name: 'Login smoke',
    description: 'Verifies the user can reach the login screen.',
    platform: 'cross-platform',
    app_package: 'com.example.app',
    metadata: {
      app_version: 'staging-latest',
      environment: 'staging',
    },
    steps: [
      {
        id: 'launch',
        action: 'launch_app',
        description: 'Launch the app',
      },
    ],
    assertions: [
      {
        id: 'login_visible',
        after_step: 'launch',
        type: 'element_exists',
        description: 'Login button is present',
      },
    ],
  };
}

describe('ScenarioValidator', () => {
  test('a minimal schema-conformant scenario is valid', () => {
    const v = new ScenarioValidator({ schemaPath: SCHEMA_PATH });
    const res = v.validate(validScenario());
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
  });

  // #281: a screenshot_match may mask regions, as elements or rectangles.
  test('screenshot_match masks of either shape are valid', () => {
    const v = new ScenarioValidator({ schemaPath: SCHEMA_PATH });
    const s = validScenario();
    s.assertions[0] = {
      ...s.assertions[0],
      type: 'screenshot_match',
      tolerance: 0.95,
      masks: [{ element_description: 'Clock' }, { x: 0, y: 0, width: 390, height: 44 }],
    };
    const res = v.validate(s);
    expect(res.errors).toEqual([]);
    expect(res.valid).toBe(true);
  });

  test.each([
    ['a negative rect', { x: -1, y: 0, width: 1, height: 1 }],
    ['a partial rect', { x: 0, y: 0, width: 1 }],
    ['both shapes at once', { element_description: 'Clock', x: 0, y: 0, width: 1, height: 1 }],
    ['an empty description', { element_description: '' }],
  ])('a mask that is %s is invalid', (_name, mask) => {
    const v = new ScenarioValidator({ schemaPath: SCHEMA_PATH });
    const s = validScenario();
    s.assertions[0] = { ...s.assertions[0], type: 'screenshot_match', masks: [mask] };
    expect(v.validate(s).valid).toBe(false);
  });

  // #255: launch_app cold-starts by default; `cold: false` opts out.
  test('a launch_app step with cold: false is valid', () => {
    const v = new ScenarioValidator({ schemaPath: SCHEMA_PATH });
    const s = validScenario();
    s.steps[0].cold = false;
    const res = v.validate(s);
    expect(res.errors).toEqual([]);
    expect(res.valid).toBe(true);
  });

  test('a non-boolean cold is invalid', () => {
    const v = new ScenarioValidator({ schemaPath: SCHEMA_PATH });
    const s = validScenario();
    s.steps[0].cold = 'no';
    const res = v.validate(s);
    expect(res.valid).toBe(false);
    expect(res.errors.join(' ')).toMatch(/cold/);
  });

  test('a scenario missing a required top-level field is invalid with readable errors', () => {
    const v = new ScenarioValidator({ schemaPath: SCHEMA_PATH });
    const bad = validScenario();
    delete bad.app_package;
    const res = v.validate(bad);
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.errors.every((e) => typeof e === 'string')).toBe(true);
    expect(res.errors.join(' ')).toMatch(/app_package/);
  });

  test('reports all errors (allErrors), not just the first', () => {
    const v = new ScenarioValidator({ schemaPath: SCHEMA_PATH });
    const bad = validScenario();
    delete bad.app_package;
    delete bad.name;
    const res = v.validate(bad);
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThanOrEqual(2);
  });

  test('defaults to the repo schema path when none is provided', () => {
    const v = new ScenarioValidator();
    const res = v.validate(validScenario());
    expect(res.valid).toBe(true);
  });
});
