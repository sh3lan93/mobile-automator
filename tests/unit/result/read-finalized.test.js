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
