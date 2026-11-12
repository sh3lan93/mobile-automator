'use strict';

// handleRun: a run always ends finalized. An unexpected error (a store write,
// a bug) must not leave the result file `_in_progress`, and must still reach
// withEnvelope as the error it was.

const crypto = require('crypto');
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

// The scenario as prepareRun hands it over: parsed, plus its file and hash.
function prepared(sc, name = 'demo.json', dir = root) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(sc));
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  return { scenario: sc, runId: RUN_ID, file, sha256, deviceId: 'emulator-5554' };
}

const resultFile = () => JSON.parse(fs.readFileSync(path.join(root, '.mobile-automator', 'results', `${RUN_ID}.json`), 'utf8'));

test('a passing run is finalized once and reported ok', async () => {
  const d = deps((args) => new ResultStore(args));
  const r = await handleRun(d, prepared(scenario));
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
  await expect(handleRun(d, prepared(scenario))).rejects.toBe(boom);
  expect(d.finalizeRun).toHaveBeenCalledTimes(1);
  const file = resultFile();
  expect(file).not.toHaveProperty('_in_progress');
  expect(file.status).toBe('error');
  // The aborted run still says who ran it, against what.
  expect(file.executor).toMatchObject({ kind: 'runner', scenario_path: 'demo.json' });
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
  await expect(handleRun(d, prepared(scenario))).rejects.toBe(boom);
  expect(d.finalizeRun).toHaveBeenCalledTimes(1);
});

describe('provenance and the incomplete run (#275)', () => {
  const tier2 = {
    ...scenario,
    assertions: [
      ...scenario.assertions,
      { id: 'looks', after_step: 'tap_more', type: 'visual_state', description: 'd', expected_visual_state: 'loaded' },
    ],
  };

  test('the executor is the runner, with the device, the platform and the scenario path + sha256', async () => {
    const d = deps((args) => new ResultStore(args));
    const p = prepared(scenario);
    const r = await handleRun(d, p);
    expect(r.exitKind).toBe('ok');
    expect(r.envelope.data.pending).toEqual([]);
    expect(r.envelope.data.executor).toMatchObject({
      kind: 'runner',
      platform: 'android',
      device_id: 'emulator-5554',
      scenario_path: 'demo.json',
      scenario_sha256: p.sha256,
    });
    expect(resultFile().executor).toEqual(r.envelope.data.executor);
  });

  test('a scenario outside the project root is recorded by its absolute path', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-handle-outside-'));
    try {
      const r = await handleRun(deps((args) => new ResultStore(args)), prepared(scenario, 'x.json', outside));
      expect(r.envelope.data.executor.scenario_path).toBe(path.join(outside, 'x.json'));
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test('a relative scenario file resolves against the cwd dep, recorded relative to the root', async () => {
    const sub = path.join(root, 'sub');
    fs.mkdirSync(sub);
    const p = prepared(scenario);
    const r = await handleRun({ ...deps((args) => new ResultStore(args)), cwd: sub }, { ...p, file: path.join('..', 'demo.json') });
    expect(r.envelope.data.executor.scenario_path).toBe('demo.json');
  });

  test('a platform the bridge cannot report is recorded null, hinted, and the run goes on', async () => {
    const d = deps((args) => new ResultStore(args));
    const unknown = Object.assign(new Error('Cannot determine the platform of device "x".'), { code: 'platform_unknown' });
    d.bridge = makeFakeBridge({ elements: [[el('More')]], methods: { getPlatform: () => { throw unknown; } } });
    const r = await handleRun(d, prepared(scenario));
    expect(r.exitKind).toBe('ok');
    expect(r.envelope.data.executor.platform).toBeNull();
    expect(r.envelope.hint).toContain('platform unknown: the bridge could not report it');
  });

  test('any other getPlatform failure propagates instead of becoming a null platform', async () => {
    const d = deps((args) => new ResultStore(args));
    d.bridge = makeFakeBridge({ elements: [[el('More')]], methods: { getPlatform: () => { throw new Error('no device'); } } });
    await expect(handleRun(d, prepared(scenario))).rejects.toThrow('no device');
  });

  test('a Tier-2 assertion nobody judged: incomplete (exit kind), data.pending, and the commands that complete it', async () => {
    const d = deps((args) => new ResultStore(args));
    const r = await handleRun(d, prepared(tier2));
    expect(r.exitKind).toBe('incomplete');
    expect(r.envelope.ok).toBe(false);
    expect(r.envelope.error).toMatchObject({ kind: 'incomplete', message: `run ${RUN_ID} incomplete: 1 assertion(s) need agent judgment` });
    expect(r.envelope.data).toMatchObject({
      status: 'incomplete',
      failures: [],
      pending: [{ assertion_id: 'looks', step_id: 'tap_more', type: 'visual_state' }],
    });
    expect(r.envelope.hint).toContain(`--assertion-id looks --type visual_state --pass <true|false> --judge agent`);
    expect(r.envelope.hint).toContain(`mauto result finalize --run-id ${RUN_ID} --scenario ${path.join(root, 'demo.json')}`);
    expect(resultFile().status).toBe('incomplete');
  });

  test('a failure beside a pending assertion is test_failed, still listing what is pending', async () => {
    const d = deps((args) => new ResultStore(args));
    d.bridge = makeFakeBridge({ elements: [[el('More')]] });
    const failing = {
      ...tier2,
      assertions: [
        { id: 'a', after_step: 'tap_more', type: 'element_exists', description: 'd', element_description: 'Nope' },
        tier2.assertions[1],
      ],
    };
    const r = await handleRun(d, prepared(failing));
    expect(r.exitKind).toBe('test_failed');
    expect(r.envelope.data.status).toBe('failed');
    expect(r.envelope.data.pending).toEqual([{ assertion_id: 'looks', step_id: 'tap_more', type: 'visual_state' }]);
  });
});
