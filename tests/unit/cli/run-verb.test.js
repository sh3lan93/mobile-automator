'use strict';

// `mauto run <scenario>` (replay R1, #278) through the real program: the gate,
// the pre-device refusals, and a whole run on a scripted fake bridge, asserting
// on the envelope and on the result file the verb finalizes.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildProgram, handleRun } = require('../../../src/cli');
const { runTracePath } = require('../../../src/observe/paths');
const { readTrace } = require('../../../src/observe/trace');
const { makeFakeBridge, makeFakeClock, homeElements } = require('../../helpers/fake-bridge');

const RUN_ID = 'run_20261111_093000';
const ENV_KEYS = ['MAUTO_REPLAY', 'MAUTO_RUN_ID', 'MAUTO_LOG_DIR', 'MAUTO_LOG_LEVEL'];

let saved;
let root;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-run-verb-'));
  // A real workspace: the file sinks (and so the run trace) write only into
  // an existing .mobile-automator/, never creating one.
  fs.mkdirSync(path.join(root, '.mobile-automator'));
  fs.writeFileSync(path.join(root, '.mobile-automator', 'config.json'), '{}');
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(root, { recursive: true, force: true });
});

// A real device call takes time; a fake one that resolves on the same
// millisecond would leave the run trace spanning zero time, which finalize
// rightly refuses to call a measurement.
const slow = (value = null) => () => new Promise((r) => setTimeout(() => r(value), 15));

function scenario({ steps, assertions = [] } = {}) {
  return {
    $schema_version: '2.1',
    scenario_id: 'demo',
    name: 'Demo',
    description: 'd',
    platform: 'android',
    app_package: 'com.example.app',
    mode: 'platform-agnostic',
    metadata: { app_version: 'debug', environment: 'ci' },
    steps: steps || [
      { id: 'launch', action: 'launch_app', description: 'Launch' },
      { id: 'tap_more', action: 'tap', description: 'Tap More', target: 'More' },
    ],
    assertions,
  };
}

function writeScenario(sc, name = 'demo.json') {
  const file = path.join(root, name);
  fs.writeFileSync(file, typeof sc === 'string' ? sc : JSON.stringify(sc));
  return file;
}

async function runCli(args, { bridge = makeFakeBridge({ elements: [homeElements()] }) } = {}) {
  const emitted = [];
  const factory = jest.fn(async () => ({ bridge, close: async () => {} }));
  await buildProgram({
    projectRoot: root,
    deviceBridgeFactory: factory,
    emit: (r) => emitted.push(r),
    clock: makeFakeClock(),
    platform: 'darwin',
  }).parseAsync(['node', 'mauto', 'run', ...args]);
  expect(emitted).toHaveLength(1);
  return { r: emitted[0], factory, bridge };
}

describe('mauto run — refusals before any device work', () => {
  test('refuses with environment (exit 5) when MAUTO_REPLAY is unset, and never connects', async () => {
    const file = writeScenario(scenario());
    const { r, factory } = await runCli([file, '--run-id', RUN_ID]);
    expect(r.exitKind).toBe('environment');
    expect(r.envelope.error.message).toBe('mauto run is not enabled yet');
    expect(r.envelope.hint).toMatch(/MAUTO_REPLAY=1/);
    expect(factory).not.toHaveBeenCalled();
  });

  test('refuses when MAUTO_REPLAY is anything but exactly 1', async () => {
    process.env.MAUTO_REPLAY = 'true';
    const { r, factory } = await runCli([writeScenario(scenario()), '--run-id', RUN_ID]);
    expect(r.exitKind).toBe('environment');
    expect(factory).not.toHaveBeenCalled();
  });

  describe('with the gate set', () => {
    beforeEach(() => {
      process.env.MAUTO_REPLAY = '1';
    });

    test('an unreadable scenario is invalid_input', async () => {
      const { r, factory } = await runCli([path.join(root, 'missing.json'), '--run-id', RUN_ID]);
      expect(r.exitKind).toBe('invalid_input');
      expect(r.envelope.error.message).toMatch(/cannot read file/);
      expect(factory).not.toHaveBeenCalled();
    });

    test('a schema-invalid scenario is invalid_input', async () => {
      const bad = scenario();
      delete bad.app_package;
      const { r, factory } = await runCli([writeScenario(bad), '--run-id', RUN_ID]);
      expect(r.exitKind).toBe('invalid_input');
      expect(r.envelope.error.message).toBe('scenario failed schema validation');
      expect(factory).not.toHaveBeenCalled();
    });

    test('a strict-blocking replayability finding (duplicate step id) is invalid_input', async () => {
      const dup = scenario({
        steps: [
          { id: 'launch', action: 'launch_app', description: 'Launch' },
          { id: 'launch', action: 'tap', description: 'Tap More', target: 'More' },
        ],
      });
      const { r, factory } = await runCli([writeScenario(dup), '--run-id', RUN_ID]);
      expect(r.exitKind).toBe('invalid_input');
      expect(r.envelope.error.message).toMatch(/cannot replay unattended/);
      expect(factory).not.toHaveBeenCalled();
    });

    test('a malformed --run-id is invalid_input naming the expected shape, and never connects', async () => {
      const { r, factory } = await runCli([writeScenario(scenario()), '--run-id', '../escape']);
      expect(r.exitKind).toBe('invalid_input');
      expect(r.envelope.hint).toMatch(/run_YYYYMMDD_HHMMSS/);
      expect(factory).not.toHaveBeenCalled();
    });
  });
});

describe('mauto run — a run', () => {
  beforeEach(() => {
    process.env.MAUTO_REPLAY = '1';
  });

  test('a passing scenario is ok, finalizes a passed result file and measures from the run trace', async () => {
    const bridge = makeFakeBridge({ elements: [homeElements()], methods: { restartApp: slow(), tap: slow() } });
    const { r, factory } = await runCli([writeScenario(scenario()), '--run-id', RUN_ID], { bridge });

    expect(factory).toHaveBeenCalledTimes(1);
    expect(r.exitKind).toBe('ok');
    const { data } = r.envelope;
    expect(data).toMatchObject({ run_id: RUN_ID, scenario_id: 'demo', status: 'passed', failed_step: null, failures: [] });
    expect(data.result_path).toBe(path.join('.mobile-automator', 'results', `${RUN_ID}.json`));

    const file = JSON.parse(fs.readFileSync(path.join(root, data.result_path), 'utf8'));
    expect(file.status).toBe('passed');
    expect(file.steps_executed.map((s) => s.step_id)).toEqual(['launch', 'tap_more']);

    // run.start + one run.step per step were stamped before finalize, spanning
    // the (real) time the device calls took.
    const events = readTrace(runTracePath(root, RUN_ID)).events;
    expect(events.filter((e) => e.event === 'run.start')).toHaveLength(1);
    expect(events.filter((e) => e.event === 'run.step')).toHaveLength(2);
    expect(events.every((e) => e.verb === 'run' && e.run_id === RUN_ID)).toBe(true);
    expect(data.measurements.source).toBe('trace');
    expect(data.measurements.trace_events).toBeGreaterThanOrEqual(3);
    expect(file.duration_seconds).toBeGreaterThan(0);
  });

  test('a failing assertion is test_failed with data.status failed', async () => {
    const sc = scenario({
      assertions: [
        { id: 'hdr', after_step: 'tap_more', type: 'element_text', description: 'd', element_description: 'More', expected_value: 'Nope' },
      ],
    });
    const { r } = await runCli([writeScenario(sc), '--run-id', RUN_ID]);
    expect(r.exitKind).toBe('test_failed');
    expect(r.envelope.error.message).toBe(`run ${RUN_ID} failed`);
    expect(r.envelope.data.status).toBe('failed');
    expect(r.envelope.data.failed_step).toBeNull();
    expect(r.envelope.data.failures.join('\n')).toMatch(/hdr/);
  });

  test('a failed step is test_failed naming data.failed_step, with only the runner\'s failure screenshot', async () => {
    const sc = scenario({
      steps: [
        { id: 'launch', action: 'launch_app', description: 'Launch' },
        { id: 'tap_x', action: 'tap', description: 'Tap', target: 'Definitely Not On Screen' },
      ],
    });
    const bridge = makeFakeBridge({ elements: [homeElements()] });
    const { r } = await runCli([writeScenario(sc), '--run-id', RUN_ID], { bridge });
    expect(r.exitKind).toBe('test_failed');
    expect(r.envelope.data.failed_step).toBe('tap_x');
    expect(r.envelope.data.status).toBe('failed');

    // test_failed is not a captured kind: connectBridge adds no second shot.
    const shots = bridge.of('screenshot').map((c) => path.basename(c.args[0]));
    expect(shots).toEqual(['step_tap_x_failure.png']);
  });

  test('mints a run id when neither --run-id nor MAUTO_RUN_ID is given', async () => {
    const { r } = await runCli([writeScenario(scenario())]);
    expect(r.exitKind).toBe('ok');
    expect(r.envelope.data.run_id).toMatch(/^run_\d{8}_\d{6}$/);
    expect(fs.existsSync(path.join(root, r.envelope.data.result_path))).toBe(true);
  });

  test('takes the run id from MAUTO_RUN_ID when no --run-id is given', async () => {
    process.env.MAUTO_RUN_ID = RUN_ID;
    const { r } = await runCli([writeScenario(scenario())]);
    expect(r.envelope.data.run_id).toBe(RUN_ID);
  });
});

describe('mauto run — registration', () => {
  test('is hidden from --help', () => {
    const help = buildProgram({ projectRoot: root, emit: () => {} }).helpInformation();
    expect(help).not.toMatch(/^\s+run\b/m);
    expect(help).toMatch(/^\s+validate\b/m);
  });

  test('handleRun is exported', () => {
    expect(typeof handleRun).toBe('function');
  });
});
