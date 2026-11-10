'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { ResultStore, readFinalizedResult, resultFile, isResultRunId } = require('../../../src/result/store');
const { workspaceDir } = require('../../../src/workspace/layout');

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

  // "Finalized" is owned by the writer: whatever `ResultStore#finalize` writes
  // must read back, whatever flags the run was recorded with (#274 review: a
  // run finalized without --scenario-id, or with a non run_YYYYMMDD_HHMMSS id,
  // was refused by export).
  describe('accepts whatever ResultStore#finalize writes', () => {
    test.each([
      ['with a scenario id', RUN_ID, 'login'],
      ['without a scenario id', RUN_ID, undefined],
      ['with a run id outside the run_YYYYMMDD_HHMMSS form', 'ci-build-42', undefined],
      ['with a dotted run id', 'nightly.2026-11-09', 'login'],
    ])('%s', (_label, runId, scenarioId) => {
      const root = tmpRoot();
      const store = new ResultStore({ runId, scenarioId, projectRoot: root });
      store.addStep({ step_id: 'a', status: 'fail' });
      const finalized = store.finalize({ durationSeconds: 1 });
      expect(readFinalizedResult(root, runId)).toEqual({ result: finalized });
    });
  });

  test('isResultRunId accepts any id naming a file inside results/', () => {
    for (const id of ['run_20261027_101500', 'run_2026', 'ci-build-42', 'run_20261027_100000.json', '.', '..', '...']) {
      expect(isResultRunId(id)).toBe(true);
    }
    for (const id of ['', '../escape', 'a/b', '/abs', '../../etc/passwd', 'a\u0000b', null, undefined, 42]) {
      expect(isResultRunId(id)).toBe(false);
    }
  });

  test('an id containing a path separator is refused without touching the disk', () => {
    for (const id of ['../escape', 'a/b', '../../etc/passwd']) {
      const root = tmpRoot();
      const { error } = readFinalizedResult(root, id);
      expect(error).toEqual({
        kind: 'invalid_input',
        message: `invalid run id "${id}"`,
        hint: `A run id names a file in ${path.join(workspaceDir(root), 'results')}; it cannot contain a path separator.`,
      });
    }
  });

  test('an id outside the run_YYYYMMDD_HHMMSS form is looked up, not refused', () => {
    for (const id of ['run_2026', 'ci-build-42', 'run_20261027_100000.json']) {
      expect(readFinalizedResult(tmpRoot(), id).error.message).toBe(`no result file for ${id}`);
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

  // What readFinalizedResult refuses: anything that is not an object finalize
  // wrote for THIS run. Shape beyond that is the renderer's to tolerate.
  describe('a parsed value that is not a finalized result is invalid_input', () => {
    const finalized = () => {
      const root = tmpRoot();
      const store = new ResultStore({ runId: RUN_ID, scenarioId: 'login', projectRoot: root });
      return store.finalize({ status: 'passed', durationSeconds: 1 });
    };
    const withoutRunId = () => {
      const r = finalized();
      delete r.run_id;
      return r;
    };

    test.each([
      ['null', null, /\(root\) must be object$/],
      ['an array', [], /\(root\) must be object$/],
      ['a scalar', 42, /\(root\) must be object$/],
      ['an empty object', {}, /its run_id is undefined$/],
      ['a result missing run_id', withoutRunId(), /its run_id is undefined$/],
      ['a mismatched run_id', { ...finalized(), run_id: 'run_20990101_000000' }, /run_id is "run_20990101_000000"/],
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

    test('an in-progress marker wins over everything else', () => {
      const root = tmpRoot();
      fs.writeFileSync(resultFile(root, RUN_ID), JSON.stringify({ _in_progress: true }));
      expect(readFinalizedResult(root, RUN_ID).error.message).toBe(`run ${RUN_ID} is not finalized`);
    });
  });

  // Keys finalize always writes but an older or hand-edited file may lack are
  // not the reader's to police: they read, and the renderer tolerates them.
  test.each([
    ['a null scenario_id', (r) => ({ ...r, scenario_id: null })],
    ['an off-enum status', (r) => ({ ...r, status: 'FAILED' })],
    ['a null metadata', (r) => ({ ...r, metadata: null })],
    ['a null step', (r) => ({ ...r, steps_executed: [null] })],
  ])('a run-id-matching object with %s is accepted as written', (_label, mutate) => {
    const root = tmpRoot();
    const store = new ResultStore({ runId: RUN_ID, scenarioId: 'login', projectRoot: root });
    const value = mutate(store.finalize({ status: 'passed', durationSeconds: 1 }));
    fs.writeFileSync(resultFile(root, RUN_ID), JSON.stringify(value));
    expect(readFinalizedResult(root, RUN_ID)).toEqual({ result: value });
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
