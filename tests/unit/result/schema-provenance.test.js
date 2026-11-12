'use strict';

// The R2 provenance additions (#275) are optional: result files written before
// them must keep validating with the CLI's own Ajv, and a file carrying every
// new field must validate too.

const fs = require('fs');
const path = require('path');

const { createCliAjv } = require('../../../src/schemas/cli-ajv');
const schema = require('../../../src/schemas/result_schema.json');
const baseline = require('../../fixtures/result_schema_v2.0.json');

const FIXTURES = path.join(__dirname, 'fixtures');
const fixtureFiles = fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.json'));
// Fixtures written before #275, which the 2.0 baseline schema must accept too.
const LEGACY_FIXTURES = ['failed-nothing-recorded.json', 'failed.json', 'hostile-strings.json', 'passed.json'];

const compile = (s) => {
  const ajv = createCliAjv();
  // The schema declares format: date-time and the CLI registers no formats;
  // silence Ajv's console warning for it, as the CLI tolerates it.
  ajv.addFormat('date-time', true);
  return ajv.compile(s);
};
const validate = compile(schema);
const validateBaseline = compile(baseline);

const read = (f) => JSON.parse(fs.readFileSync(path.join(FIXTURES, f), 'utf8'));

function fullResult() {
  return {
    ...read('passed.json'),
    status: 'incomplete',
    steps_executed: [{ step_id: 'tap_login', status: 'passed', needs_agent: true }],
    assertion_results: [
      {
        assertion_id: 'a1',
        status: 'needs_agent',
        message: '',
        type: 'visual_state',
        step_id: 'tap_login',
        mechanical: false,
        judge: { by: 'none' },
      },
      {
        assertion_id: 'a2',
        status: 'passed',
        message: 'ok',
        type: 'element_exists',
        step_id: 'tap_login',
        mechanical: true,
        judge: { by: 'mauto', name: 'evaluator', version: '0.40.0' },
      },
    ],
    executor: {
      kind: 'runner',
      mauto_version: '0.40.0-rc.1',
      engine: 'mobilecli',
      platform: 'android',
      device_id: 'emulator-5554',
      scenario_path: 'scenarios/login.json',
      scenario_sha256: 'a'.repeat(64),
      mode: 'platform-agnostic',
    },
  };
}

describe('result schema provenance additions (#275)', () => {
  test.each(LEGACY_FIXTURES)('2.0-era fixture %s validates under the baseline and the current schema', (f) => {
    const doc = read(f);
    expect(validateBaseline(doc)).toBe(true);
    expect(validate(doc)).toBe(true);
  });

  test.each(fixtureFiles)('fixture %s validates under the current schema', (f) => {
    expect(validate(read(f))).toBe(true);
  });

  test('a result carrying every new field validates', () => {
    const ok = validate(fullResult());
    expect(validate.errors).toBeNull();
    expect(ok).toBe(true);
  });

  test('an executor with null optional fields validates', () => {
    const doc = fullResult();
    doc.executor = {
      kind: 'agent', mauto_version: '0.40.0', engine: null, platform: null,
      device_id: null, scenario_path: null, scenario_sha256: null, mode: null,
    };
    expect(validate(doc)).toBe(true);
  });

  test.each([
    ['executor without kind', (d) => { delete d.executor.kind; }],
    ['executor without mauto_version', (d) => { delete d.executor.mauto_version; }],
    ['executor kind outside runner|agent', (d) => { d.executor.kind = 'human'; }],
    ['judge.by outside mauto|agent|none', (d) => { d.assertion_results[0].judge.by = 'gpt'; }],
    ['assertion status outside the enum', (d) => { d.assertion_results[0].status = 'pending'; }],
    ['run status outside the enum', (d) => { d.status = 'pending'; }],
    ['mechanical not a boolean', (d) => { d.assertion_results[0].mechanical = 'yes'; }],
    ['step needs_agent not a boolean', (d) => { d.steps_executed[0].needs_agent = 'yes'; }],
  ])('rejects %s', (_name, mutate) => {
    const doc = fullResult();
    mutate(doc);
    expect(validate(doc)).toBe(false);
  });

  test('required arrays are unchanged from the baseline', () => {
    expect(schema.required).toEqual(baseline.required);
    expect(schema.properties.assertion_results.items.required).toEqual(baseline.properties.assertion_results.items.required);
    expect(schema.properties.steps_executed.items.required).toEqual(baseline.properties.steps_executed.items.required);
  });
});
