'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { ResultStore, readFinalizedResult, resultFile } = require('../../../src/result/store');
const { workspaceDir } = require('../../../src/workspace/layout');
const RESULT_SCHEMA = require('../../../src/schemas/result_schema.json');

const RUN_ID = 'run_20261027_101500';

function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-read-finalized-'));
  fs.mkdirSync(path.join(workspaceDir(root), 'results'), { recursive: true });
  return root;
}

const listResults = (root) => fs.readdirSync(path.join(workspaceDir(root), 'results')).sort();

describe('resultFile', () => {
  test('is the path the store itself persists to', () => {
    const root = tmpRoot();
    const store = new ResultStore({ runId: RUN_ID, scenarioId: 's', projectRoot: root });
    store.addStep({ step_id: 'a', status: 'pass' });
    expect(fs.existsSync(resultFile(root, RUN_ID))).toBe(true);
    expect(listResults(root)).toEqual([`${RUN_ID}.json`]);
  });
});

describe('readFinalizedResult', () => {
  test('returns a result finalized through the store', () => {
    const root = tmpRoot();
    const store = new ResultStore({ runId: RUN_ID, scenarioId: 'login', projectRoot: root });
    store.addStep({ step_id: 'a', status: 'pass' });
    const finalized = store.finalize({ status: 'passed', durationSeconds: 1 });
    expect(readFinalizedResult(root, RUN_ID)).toEqual({ result: finalized });
  });

  test('an in-progress run (written by the store) is not finalized', () => {
    const root = tmpRoot();
    new ResultStore({ runId: RUN_ID, scenarioId: 's', projectRoot: root }).addStep({ step_id: 'a', status: 'pass' });
    const { error } = readFinalizedResult(root, RUN_ID);
    expect(error.kind).toBe('invalid_input');
    expect(error.message).toMatch(/not finalized/);
    expect(error.hint).toBe(`Run \`mauto result finalize --run-id ${RUN_ID}\` first.`);
  });

  test('the run-id check is the result schema run_id pattern', () => {
    // Both directions: an id the schema accepts reads (here: no file), an id it
    // rejects never touches the disk.
    const pattern = new RegExp(RESULT_SCHEMA.properties.run_id.pattern);
    for (const id of ['run_20261027_101500', '../../etc/passwd', 'run_2026', 'run_20261027_100000.json']) {
      const { error } = readFinalizedResult(tmpRoot(), id);
      if (pattern.test(id)) {
        expect(error.message).toMatch(/no result file/);
      } else {
        expect(error).toEqual({
          kind: 'invalid_input',
          message: `invalid run id "${id}"`,
          hint: 'A run id has the form run_YYYYMMDD_HHMMSS.',
        });
      }
    }
  });

  test('a missing file is invalid_input naming the expected path', () => {
    const root = tmpRoot();
    const { error } = readFinalizedResult(root, RUN_ID);
    expect(error.kind).toBe('invalid_input');
    expect(error.message).toBe(`no result file for ${RUN_ID}`);
    expect(error.hint).toContain(resultFile(root, RUN_ID));
  });

  test('a corrupt file is reported and NOT renamed aside (unlike the store constructor)', () => {
    const root = tmpRoot();
    fs.writeFileSync(resultFile(root, RUN_ID), '{ not json');
    const { error } = readFinalizedResult(root, RUN_ID);
    expect(error.kind).toBe('invalid_input');
    expect(error.message).toMatch(/not valid JSON/);
    expect(fs.readFileSync(resultFile(root, RUN_ID), 'utf8')).toBe('{ not json');
    expect(listResults(root)).toEqual([`${RUN_ID}.json`]);
  });

  // "Finalized" is positive: valid against the shipped result schema at every
  // level, for THIS run. Anything else must never reach a renderer, where it
  // would crash or export as a green suite (#274).
  describe('a parsed value that is not a finalized result is invalid_input', () => {
    const finalized = () => {
      const root = tmpRoot();
      const store = new ResultStore({ runId: RUN_ID, scenarioId: 'login', projectRoot: root });
      return store.finalize({ status: 'passed', durationSeconds: 1 });
    };
    const withoutKey = (key) => {
      const r = finalized();
      delete r[key];
      return r;
    };
    const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const [firstRequired, ...otherRequired] = RESULT_SCHEMA.required;

    test.each([
      ['null', null, /\(root\) must be object$/],
      ['an array', [], /\(root\) must be object$/],
      ['a scalar', 42, /\(root\) must be object$/],
      [
        'an empty object',
        {},
        new RegExp(escape(`(root) is missing required property '${firstRequired}' (and ${otherRequired.length} more)`)),
      ],
      ['a mismatched run_id', { ...finalized(), run_id: 'run_20990101_000000' }, /run_id is "run_20990101_000000"/],
      ...RESULT_SCHEMA.required
        .filter((k) => k !== 'run_id')
        .map((k) => [`a result missing ${k}`, withoutKey(k), new RegExp(escape(`(root) is missing required property '${k}'`) + '$')]),
      ['a null metadata', { ...finalized(), metadata: null }, /\/metadata must be object$/],
      ['an object steps_executed', { ...finalized(), steps_executed: {} }, /\/steps_executed must be array$/],
      ['a fractional total_assertions', { ...finalized(), total_assertions: 1.5 }, /\/total_assertions must be integer$/],
      ['an off-enum status', { ...finalized(), status: 'garbage' }, /\/status must be equal to one of the allowed values/],
      ['a null assertion', { ...finalized(), assertion_results: [null] }, /\/assertion_results\/0 must be object$/],
      ['a null step', { ...finalized(), steps_executed: [null] }, /\/steps_executed\/0 must be object$/],
      [
        'an assertion without assertion_id',
        { ...finalized(), assertion_results: [{ status: 'failed', message: 'x' }] },
        /\/assertion_results\/0 is missing required property 'assertion_id'$/,
      ],
      [
        'a step without step_id',
        { ...finalized(), steps_executed: [{ status: 'failed' }] },
        /\/steps_executed\/0 is missing required property 'step_id'$/,
      ],
    ])('%s', (_label, value, message) => {
      const root = tmpRoot();
      fs.writeFileSync(resultFile(root, RUN_ID), JSON.stringify(value));
      const { result, error } = readFinalizedResult(root, RUN_ID);
      expect(result).toBeUndefined();
      expect(error.kind).toBe('invalid_input');
      expect(error.message).toMatch(new RegExp(`^result file for ${RUN_ID} is not a finalized result`));
      expect(error.message).toMatch(message);
      expect(error.hint).toContain(resultFile(root, RUN_ID));
      expect(listResults(root)).toEqual([`${RUN_ID}.json`]);
    });
  });

  test('an unreadable file (not ENOENT) is environment', () => {
    const root = tmpRoot();
    // A directory at the result path makes the read fail with EISDIR.
    fs.mkdirSync(resultFile(root, RUN_ID));
    const { error } = readFinalizedResult(root, RUN_ID);
    expect(error.kind).toBe('environment');
    expect(error.message).toMatch(/^could not read .*EISDIR/);
    expect(error.hint).toBeNull();
  });
});
