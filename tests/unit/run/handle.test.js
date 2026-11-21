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

  test('a step that needs an agent: incomplete (exit kind), and the hint says what to do by hand', async () => {
    const d = deps((args) => new ResultStore(args));
    const needsHand = { ...scenario, steps: [{ id: 'wifi_off', action: 'disable_wifi', description: 'd' }], assertions: [] };
    const r = await handleRun(d, prepared(needsHand));
    expect(r.exitKind).toBe('incomplete');
    expect(r.envelope.error).toMatchObject({ kind: 'incomplete', message: `run ${RUN_ID} incomplete` });
    expect(r.envelope.data).toMatchObject({ status: 'incomplete', failed_step: null, failures: [], pending: [] });
    expect(r.envelope.hint).toContain('Pending step wifi_off: disable_wifi cannot be run by mauto');
    expect(r.envelope.hint).toContain(`mauto result finalize --run-id ${RUN_ID} --scenario ${path.join(root, 'demo.json')}`);
    expect(resultFile().steps_executed[0]).toMatchObject({ step_id: 'wifi_off', status: 'skipped', needs_agent: true });
  });

  // #329: a sub-step the runner cannot perform leaves its PARENT pending. The
  // hint must say which sub-step stopped it and which already ran, and the
  // agent records the parent (never the sub-step) to complete the run.
  test('a sub-step that needs an agent: the hint names it and the parent is what gets recorded', async () => {
    const d = deps((args) => new ResultStore(args));
    const nested = {
      ...scenario,
      steps: [{
        id: 'offline', action: 'tap', description: 'd', target: 'More',
        sub_steps: [
          { id: 'open_more', action: 'tap', description: 'd', target: 'More' },
          { id: 'wifi_off', action: 'disable_wifi', description: 'd' },
          { id: 'retry', action: 'tap', description: 'd', target: 'More' },
        ],
      }],
      assertions: [],
    };
    d.bridge = makeFakeBridge({ elements: [[el('More')]] });
    const r = await handleRun(d, prepared(nested));
    expect(r.exitKind).toBe('incomplete');
    expect(r.envelope.hint).toContain('Pending step offline: sub-step wifi_off: disable_wifi cannot be run by mauto');
    expect(r.envelope.hint).toContain(
      'Step offline stopped at its sub-step wifi_off; mauto run already ran open_more. ' +
      'Do wifi_off and every later sub-step of offline, then record offline once (not its sub-steps):'
    );
    expect(r.envelope.hint).toContain(`mauto result add-step --run-id ${RUN_ID} --step-id offline --status <pass|fail|skipped>`);

    const store = new ResultStore({ runId: RUN_ID, projectRoot: root });
    store.addStep({ step_id: 'offline', status: 'pass' });
    const result = store.finalize();
    expect(result.status).toBe('passed');
    expect(result.steps_executed).toHaveLength(1);
    expect(result.observations).toContainEqual({
      type: 'state_context',
      step_id: 'offline',
      message: expect.stringMatching(/mauto run left step 'offline' to the agent .*sub-step wifi_off.*; it had already run sub-steps open_more\. The agent recorded it passed\./),
    });
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

describe('the frozen data shape (#282)', () => {
  const KEYS = [
    'run_id', 'scenario_id', 'status', 'result_path', 'duration_seconds', 'steps', 'assertions',
    'failed_step', 'failures', 'pending', 'junit_path', 'executor',
  ];

  test('a passed run carries exactly the frozen keys, with counts from the result file', async () => {
    const r = await handleRun(deps((args) => new ResultStore(args)), prepared(scenario));
    expect(r.exitKind).toBe('ok');
    expect(Object.keys(r.envelope.data)).toEqual(KEYS);
    expect(r.envelope.data).not.toHaveProperty('measurements');
    expect(r.envelope.data.steps).toEqual({ total: 1, passed: 1, failed: 0, error: 0, skipped: 0, needs_agent: 0 });
    expect(r.envelope.data.assertions).toEqual({ total: 1, passed: 1, failed: 0, needs_agent: 0 });
    expect(r.envelope.data.junit_path).toBeNull();
    expect(r.envelope.data.duration_seconds).toBe(resultFile().duration_seconds);
  });

  test('a failed run carries exactly the frozen keys', async () => {
    const failing = { ...scenario, steps: [{ id: 'tap_x', action: 'tap', description: 'd', target: 'Nope' }], assertions: [] };
    const r = await handleRun(deps((args) => new ResultStore(args)), prepared(failing));
    expect(r.exitKind).toBe('test_failed');
    expect(Object.keys(r.envelope.data)).toEqual(KEYS);
    expect(r.envelope.data.steps).toMatchObject({ total: 1, failed: 1 });
    expect(r.envelope.data.failed_step).toBe('tap_x');
  });

  test('an incomplete run carries exactly the frozen keys; a needs_agent step counts once', async () => {
    const needsHand = { ...scenario, steps: [{ id: 'wifi_off', action: 'disable_wifi', description: 'd' }], assertions: [] };
    const r = await handleRun(deps((args) => new ResultStore(args)), prepared(needsHand));
    expect(r.exitKind).toBe('incomplete');
    expect(Object.keys(r.envelope.data)).toEqual(KEYS);
    expect(r.envelope.data.steps).toEqual({ total: 1, passed: 0, failed: 0, error: 0, skipped: 0, needs_agent: 1 });
  });
});

describe('--junit (#282)', () => {
  const { toJUnit } = require('../../../src/result/junit');
  const failing = { ...scenario, steps: [{ id: 'tap_x', action: 'tap', description: 'd', target: 'Nope' }], assertions: [] };

  test.each([
    ['passed', scenario, 'ok'],
    ['failed', failing, 'test_failed'],
  ])('a %s run writes the report mauto result export would render, and names it', async (_label, sc, exitKind) => {
    const junitPath = path.join(root, 'report.xml');
    const r = await handleRun(deps((args) => new ResultStore(args)), { ...prepared(sc), junitPath });
    expect(r.exitKind).toBe(exitKind);
    expect(r.envelope.data.junit_path).toBe(junitPath);
    expect(fs.readFileSync(junitPath, 'utf8')).toBe(toJUnit([resultFile()]).xml);
  });

  test('a write that fails is environment, after finalize, with the full data and junit_path null', async () => {
    const junitPath = path.join(root, 'gone', 'report.xml');
    // The parent turns into a file after prepareRun checked it.
    fs.writeFileSync(path.join(root, 'gone'), 'x');
    const d = deps((args) => new ResultStore(args));
    const r = await handleRun(d, { ...prepared(scenario), junitPath });
    expect(r.exitKind).toBe('environment');
    expect(r.envelope.ok).toBe(false);
    expect(r.envelope.error.message).toMatch(new RegExp(`^could not write the JUnit report to ${junitPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: `));
    const resultPath = path.join('.mobile-automator', 'results', `${RUN_ID}.json`);
    expect(r.envelope.hint).toContain(resultPath);
    expect(r.envelope.data).toMatchObject({ status: 'passed', junit_path: null, result_path: resultPath });
    expect(d.finalizeRun).toHaveBeenCalledTimes(1);
    expect(resultFile().status).toBe('passed');
  });

  test('the writer is injectable; its failure overrides a test_failed exit too', async () => {
    const d = { ...deps((args) => new ResultStore(args)), writeFile: () => { throw new Error('EACCES'); } };
    const r = await handleRun(d, { ...prepared(failing), junitPath: path.join(root, 'r.xml') });
    expect(r.exitKind).toBe('environment');
    expect(r.envelope.error.message).toBe(`could not write the JUnit report to ${path.join(root, 'r.xml')}: EACCES`);
    expect(r.envelope.data.status).toBe('failed');
  });

  test('the writer is called with the project root, the path and the report', async () => {
    const writeFile = jest.fn();
    const junitPath = path.join(root, 'r.xml');
    await handleRun({ ...deps((args) => new ResultStore(args)), writeFile }, { ...prepared(scenario), junitPath });
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledWith(root, junitPath, toJUnit([resultFile()]).xml);
  });

  // #347: --junit is a path the user chose; one that lands in the workspace is
  // written through safe-fs, so a committed link on the way is refused, never
  // followed. The default writer (no writeFile injected) is the one under test.
  describe('a report path inside the workspace (#347)', () => {
    let outside;
    beforeEach(() => {
      outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-handle-run-outside-')));
      fs.writeFileSync(path.join(outside, 'r.xml'), 'SECRET-CANARY');
    });
    afterEach(() => {
      fs.rmSync(outside, { recursive: true, force: true });
    });

    test('through a symlinked directory: environment, the refusal\'s hint plus the saved result, the outside unchanged', async () => {
      const ws = path.join(root, '.mobile-automator');
      fs.mkdirSync(ws);
      fs.symlinkSync(outside, path.join(ws, 'reports'));
      const junitPath = path.join(ws, 'reports', 'r.xml');
      const d = deps((args) => new ResultStore(args));

      const r = await handleRun(d, { ...prepared(scenario), junitPath });

      expect(r.exitKind).toBe('environment');
      expect(r.envelope.ok).toBe(false);
      expect(r.envelope.error.kind).toBe('environment');
      expect(r.envelope.error.message).toMatch(/^Refusing to use workspace path /);
      expect(r.envelope.error.message).toContain(path.join(ws, 'reports'));
      const resultPath = path.join('.mobile-automator', 'results', `${RUN_ID}.json`);
      expect(r.envelope.hint).toMatch(/never follows links/);
      expect(r.envelope.hint).not.toMatch(/Check the directory exists and is writable/);
      expect(r.envelope.hint).toContain(`The run is passed and its result is saved to ${resultPath}.`);
      expect(r.envelope.data).toMatchObject({ status: 'passed', junit_path: null, result_path: resultPath });
      expect(JSON.stringify(r)).not.toContain('SECRET-CANARY');
      expect(fs.readdirSync(outside)).toEqual(['r.xml']);
      expect(fs.readFileSync(path.join(outside, 'r.xml'), 'utf8')).toBe('SECRET-CANARY');
      expect(resultFile().status).toBe('passed');
    });

    test('a clean workspace path is written', async () => {
      const junitPath = path.join(root, '.mobile-automator', 'reports', 'r.xml');
      const r = await handleRun(deps((args) => new ResultStore(args)), { ...prepared(scenario), junitPath });
      expect(r.exitKind).toBe('ok');
      expect(r.envelope.data.junit_path).toBe(junitPath);
      expect(fs.readFileSync(junitPath, 'utf8')).toBe(toJUnit([resultFile()]).xml);
    });
  });
});
