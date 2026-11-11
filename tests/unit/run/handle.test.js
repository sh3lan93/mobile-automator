'use strict';

// handleRun: a run always ends finalized. An unexpected error (a store write,
// a bug) must not leave the result file `_in_progress`, and must still reach
// withEnvelope as the error it was.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { ResultStore } = require('../../../src/result/store');
const { finalizeRun } = require('../../../src/cli');
const { handleRun } = require('../../../src/run/handle');
const { makeFakeBridge, makeFakeClock, el } = require('../../helpers/fake-bridge');

const RUN_ID = 'run_20261111_110000';

let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-handle-run-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const scenario = {
  $schema_version: '2.1',
  scenario_id: 'demo',
  app_package: 'com.example.app',
  steps: [{ id: 'tap_more', action: 'tap', description: 'd', target: 'More' }],
  assertions: [{ id: 'a', after_step: 'tap_more', type: 'element_exists', description: 'd', element_description: 'More' }],
};

function deps(resultStoreFactory, finalize = jest.fn(finalizeRun)) {
  return {
    bridge: makeFakeBridge({ elements: [[el('More')]] }),
    resultStoreFactory,
    memoryStoreFactory: null,
    projectRoot: root,
    finalizeRun: finalize,
    clock: makeFakeClock(),
  };
}

const resultFile = () => JSON.parse(fs.readFileSync(path.join(root, '.mobile-automator', 'results', `${RUN_ID}.json`), 'utf8'));

test('a passing run is finalized once and reported ok', async () => {
  const d = deps((args) => new ResultStore(args));
  const r = await handleRun(d, { scenario, runId: RUN_ID });
  expect(r.exitKind).toBe('ok');
  expect(d.finalizeRun).toHaveBeenCalledTimes(1);
  expect(resultFile().status).toBe('passed');
});

test('a store whose addAssertion throws: the run is still finalized, and the original error propagates', async () => {
  const boom = new Error('disk full');
  const d = deps((args) => {
    const store = new ResultStore(args);
    store.addAssertion = () => { throw boom; };
    return store;
  });
  await expect(handleRun(d, { scenario, runId: RUN_ID })).rejects.toBe(boom);
  expect(d.finalizeRun).toHaveBeenCalledTimes(1);
  const file = resultFile();
  expect(file).not.toHaveProperty('_in_progress');
  expect(file.status).toBe('error');
  expect(file.steps_executed.at(-1)).toMatchObject({ step_id: 'tap_more', status: 'error', error_message: 'mauto run aborted: disk full' });
});

test('a finalize that also throws does not mask the original error', async () => {
  const boom = new Error('disk full');
  const d = deps(
    (args) => {
      const store = new ResultStore(args);
      store.addAssertion = () => { throw boom; };
      return store;
    },
    jest.fn(() => { throw new Error('finalize broke too'); })
  );
  await expect(handleRun(d, { scenario, runId: RUN_ID })).rejects.toBe(boom);
  expect(d.finalizeRun).toHaveBeenCalledTimes(1);
});
