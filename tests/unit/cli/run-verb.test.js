'use strict';

// `mauto run <scenario>` (replay R1, #278) through the real program:
// the pre-device refusals, and a whole run on a scripted fake bridge, asserting
// on the envelope and on the result file the verb finalizes.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildProgram, handleRun } = require('../../../src/cli');
const { exitCodeFor, render } = require('../../../src/output/envelope');
const { runTracePath } = require('../../../src/observe/paths');
const { readTrace } = require('../../../src/observe/trace');
const { makeFakeBridge, makeFakeClock, homeElements } = require('../../helpers/fake-bridge');

const RUN_ID = 'run_20261111_093000';
const ENV_KEYS = ['MAUTO_RUN_ID', 'MAUTO_LOG_DIR', 'MAUTO_LOG_LEVEL'];

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
  fs.mkdirSync(path.dirname(file), { recursive: true });
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
  test.each(['0', '-5', '1.5', 'abc', '', '1e3'])('--timeout-ms=%j is invalid_input before any device work', async (value) => {
    const { r, factory } = await runCli([writeScenario(scenario()), '--run-id', RUN_ID, `--timeout-ms=${value}`]);
    expect(r.exitKind).toBe('invalid_input');
    expect(r.envelope.error.message).toBe(`invalid --timeout-ms "${value}"`);
    expect(r.envelope.hint).toMatch(/positive integer/);
    expect(factory).not.toHaveBeenCalled();
  });

  test('--timeout-ms caps a longer per-step wait', async () => {
    const waiting = scenario({
      steps: [{ id: 'w', action: 'wait_for_element', description: 'd', target: 'Nowhere', wait_config: { type: 'element_visible', timeout_ms: 20000 } }],
    });
    const { r } = await runCli([writeScenario(waiting), '--run-id', RUN_ID, '--timeout-ms', '3000']);
    expect(r.exitKind).toBe('test_failed');
    expect(r.envelope.data.failures[0]).toMatch(/timed out after 3000ms/);
  });

  test('--timeout-ms never lengthens a shorter wait', async () => {
    const waiting = scenario({
      steps: [{ id: 'w', action: 'wait_for_element', description: 'd', target: 'Nowhere', wait_config: { type: 'element_visible', timeout_ms: 2000 } }],
    });
    const { r } = await runCli([writeScenario(waiting), '--run-id', RUN_ID, '--timeout-ms', '9000']);
    expect(r.envelope.data.failures[0]).toMatch(/timed out after 2000ms/);
  });

  test('the config run.default_timeout_ms sets the wait of a step that names none', async () => {
    fs.writeFileSync(path.join(root, '.mobile-automator', 'config.json'), JSON.stringify({ run: { default_timeout_ms: 4000 } }));
    const waiting = scenario({
      steps: [{ id: 'w', action: 'wait_for_element', description: 'd', target: 'Nowhere' }],
    });
    const { r } = await runCli([writeScenario(waiting), '--run-id', RUN_ID]);
    expect(r.envelope.data.failures[0]).toMatch(/timed out after 4000ms/);
  });

  test('--judge other than none is invalid_input before any device work (#282)', async () => {
    const { r, factory } = await runCli([writeScenario(scenario()), '--run-id', RUN_ID, '--judge', 'agent']);
    expect(r.exitKind).toBe('invalid_input');
    expect(exitCodeFor(r.exitKind)).toBe(3);
    expect(r.envelope.error.message).toBe('unknown --judge "agent"');
    expect(r.envelope.hint).toMatch(/Accepted: none/);
    expect(factory).not.toHaveBeenCalled();
  });

  test('--judge none runs as the default does (#282)', async () => {
    const { r } = await runCli([writeScenario(scenario()), '--run-id', RUN_ID, '--judge', 'none']);
    expect(r.exitKind).toBe('ok');
  });

  test('--junit into a missing directory is invalid_input before any device work (#282)', async () => {
    const { r, factory } = await runCli([writeScenario(scenario()), '--run-id', RUN_ID, '--junit', path.join(root, 'nope', 'r.xml')]);
    expect(r.exitKind).toBe('invalid_input');
    expect(r.envelope.error.message).toBe(`--junit directory does not exist: ${path.join(root, 'nope')}`);
    expect(factory).not.toHaveBeenCalled();
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

describe('mauto run — a run', () => {
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
    // The measurements stay in the result file; the envelope carries the duration.
    expect(data).not.toHaveProperty('measurements');
    expect(file.measurements.source).toBe('trace');
    expect(file.measurements.trace_events).toBeGreaterThanOrEqual(3);
    expect(file.duration_seconds).toBeGreaterThan(0);
    expect(data.duration_seconds).toBe(file.duration_seconds);
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

  test('records the runner as the executor: the --device id, the platform, and the scenario\'s path and sha256 (#275)', async () => {
    const file = writeScenario(scenario());
    const { r, factory } = await runCli([file, '--run-id', RUN_ID, '--device', 'emulator-5554']);
    expect(r.exitKind).toBe('ok');
    expect(factory.mock.calls[0][0].device).toBe('emulator-5554');
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    expect(r.envelope.data.executor).toMatchObject({
      kind: 'runner',
      device_id: 'emulator-5554',
      platform: 'android',
      scenario_path: 'demo.json',
      scenario_sha256: sha256,
    });
    expect(r.envelope.data.pending).toEqual([]);
    const written = JSON.parse(fs.readFileSync(path.join(root, r.envelope.data.result_path), 'utf8'));
    expect(written.executor).toEqual(r.envelope.data.executor);
  });

  test('a Tier-2 assertion nobody judged is incomplete (exit kind), with data.pending and the commands that complete it (#275)', async () => {
    const sc = scenario({
      assertions: [{ id: 'looks', after_step: 'tap_more', type: 'visual_state', description: 'd', expected_visual_state: 'loaded' }],
    });
    const { r } = await runCli([writeScenario(sc), '--run-id', RUN_ID]);
    expect(r.exitKind).toBe('incomplete');
    expect(r.envelope.data.status).toBe('incomplete');
    expect(r.envelope.data.pending).toEqual([{ assertion_id: 'looks', step_id: 'tap_more', type: 'visual_state' }]);
    expect(r.envelope.hint).toContain('--judge agent');
    expect(r.envelope.hint).toContain(`finalize --run-id ${RUN_ID}`);
  });

  test('--junit writes the same report mauto result export renders, and names it (#282)', async () => {
    const out = path.join(root, 'report.xml');
    const { r } = await runCli([writeScenario(scenario()), '--run-id', RUN_ID, '--junit', out]);
    expect(r.exitKind).toBe('ok');
    expect(r.envelope.data.junit_path).toBe(out);
    const file = JSON.parse(fs.readFileSync(path.join(root, r.envelope.data.result_path), 'utf8'));
    expect(fs.readFileSync(out, 'utf8')).toBe(require('../../../src/result/junit').toJUnit([file]).xml);
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

describe('mauto run --human (#282)', () => {
  // What `emit(r, human)` receives, rendered the way the CLI's emitters
  // render it: a handler's own renderHuman under --human, else the generic
  // render. Exit codes come from the exit kind, as finish() maps them.
  async function printed(args) {
    const emitted = [];
    await buildProgram({
      projectRoot: root,
      deviceBridgeFactory: async () => ({ bridge: makeFakeBridge({ elements: [homeElements()] }), close: async () => {} }),
      emit: (r, human) => emitted.push({ r, human }),
      clock: makeFakeClock(),
      platform: 'darwin',
    }).parseAsync(['node', 'mauto', ...args]);
    expect(emitted).toHaveLength(1);
    const [{ r, human }] = emitted;
    const text = human && typeof r.renderHuman === 'function' ? r.renderHuman(r.envelope) : render(r.envelope, { human });
    return { text: `${text}\n`, exits: [exitCodeFor(r.exitKind)] };
  }

  test('a run renders as its summary', async () => {
    const { text, exits } = await printed(['--human', 'run', writeScenario(scenario()), '--run-id', RUN_ID]);
    expect(exits).toEqual([0]);
    expect(text).toMatch(new RegExp(`^run ${RUN_ID} \\(demo\\): passed in [\\d.]+s\\n`));
    expect(text).toContain('steps: 2 total, 2 passed, 0 failed, 0 error, 0 skipped, 0 needs agent\n');
  });

  test('without --human the output stays the JSON envelope', async () => {
    const { text } = await printed(['run', writeScenario(scenario()), '--run-id', RUN_ID]);
    const envelope = JSON.parse(text);
    expect(envelope.ok).toBe(true);
    expect(envelope).not.toHaveProperty('renderHuman');
    expect(Object.keys(envelope.data)).toContain('steps');
  });

  test('a refusal falls back to the generic render', async () => {
    const { text, exits } = await printed(['--human', 'run', writeScenario(scenario()), '--run-id', RUN_ID, '--judge', 'agent']);
    expect(exits).toEqual([3]);
    expect(text).toMatch(/^error \[invalid_input\]: unknown --judge "agent"\nhint: Accepted: none\b.*\n$/);
  });
});

describe('mauto run — registration', () => {
  test('is listed in --help with a plain description', () => {
    const help = buildProgram({ projectRoot: root, emit: () => {} }).helpInformation();
    expect(help).toMatch(/^\s+run \[options\] <scenario>\s+Replay a scenario unattended/m);
    expect(help).not.toMatch(/in progress/);
    expect(help).toMatch(/^\s+validate\b/m);
  });

  test('handleRun is exported', () => {
    expect(typeof handleRun).toBe('function');
  });
});

describe('an incomplete run can be completed with one-shot verbs and re-finalized (#275 exit criterion)', () => {
  // Any verb through the same program and emit seam as runCli.
  async function mauto(args, { bridge = makeFakeBridge({ elements: [homeElements()] }) } = {}) {
    const emitted = [];
    await buildProgram({
      projectRoot: root,
      deviceBridgeFactory: jest.fn(async () => ({ bridge, close: async () => {} })),
      emit: (r) => emitted.push(r),
      clock: makeFakeClock(),
      platform: 'darwin',
    }).parseAsync(['node', 'mauto', ...args]);
    expect(emitted).toHaveLength(1);
    return emitted[0];
  }

  // One mechanical assertion (decided by the CLI) and one Tier-2 one
  // (visual_state: the evaluator answers needs_agent).
  const sc = () => scenario({
    assertions: [
      { id: 'more_there', after_step: 'tap_more', type: 'element_exists', description: 'd', element_description: 'More' },
      { id: 'looks', after_step: 'tap_more', type: 'visual_state', description: 'd', expected_visual_state: 'loaded' },
    ],
  });

  // `mauto run` → exit 7, then one `result add-assertion --judge agent` per
  // pending id with `verdict`, then `result finalize --scenario`.
  async function runThenComplete(verdict) {
    const file = writeScenario(sc());
    const ran = await mauto(['run', file, '--run-id', RUN_ID]);
    expect(ran.exitKind).toBe('incomplete');
    expect(exitCodeFor(ran.exitKind)).toBe(7);
    // Pending is not a failure.
    expect(ran.envelope.data.failures).toEqual([]);
    expect(ran.envelope.data.pending).toEqual([{ assertion_id: 'looks', step_id: 'tap_more', type: 'visual_state' }]);

    for (const p of ran.envelope.data.pending) {
      const added = await mauto([
        'result', 'add-assertion', '--run-id', RUN_ID, '--step-id', p.step_id, '--assertion-id', p.assertion_id,
        '--type', p.type, '--pass', verdict, '--judge', 'agent', '--message', 'ok',
      ]);
      expect(added.exitKind).toBe('ok');
    }

    // Re-finalize with exactly the --scenario the hint printed: absolute, so
    // it works from any directory, and it names the file the run executed.
    const hinted = ran.envelope.hint.split('\n').at(-1).match(/^mauto result finalize --run-id \S+ --scenario (\S+)$/)[1];
    expect(path.isAbsolute(hinted)).toBe(true);
    expect(hinted).toBe(file);
    const finalized = await mauto(['result', 'finalize', '--run-id', RUN_ID, '--scenario', hinted]);
    const onDisk = JSON.parse(fs.readFileSync(path.join(root, '.mobile-automator', 'results', `${RUN_ID}.json`), 'utf8'));
    return { ran, finalized, onDisk };
  }

  test('--pass true: run exits 7, then finalize is ok (exit 0), passed, still the runner\'s executor', async () => {
    const { ran, finalized, onDisk } = await runThenComplete('true');
    expect(finalized.exitKind).toBe('ok');
    expect(exitCodeFor(finalized.exitKind)).toBe(0);
    expect(finalized.envelope.ok).toBe(true);
    expect(onDisk.status).toBe('passed');
    expect(onDisk.executor).toEqual(ran.envelope.data.executor);
    expect(onDisk.executor.kind).toBe('runner');

    // The pending entry was replaced in place: same position, now the agent's.
    expect(onDisk.assertion_results.map((a) => a.assertion_id)).toEqual(['more_there', 'looks']);
    expect(onDisk.assertion_results[0]).toMatchObject({ status: 'passed', mechanical: true, judge: { by: 'mauto' } });
    expect(onDisk.assertion_results[1]).toMatchObject({ status: 'passed', message: 'ok', judge: { by: 'agent' } });
  });

  test('run and finalize --scenario record the same scenario_path for the same file', async () => {
    const file = writeScenario(sc(), path.join('scenarios', 'demo.json'));
    const ran = await mauto(['run', file, '--run-id', RUN_ID]);
    const agentRun = 'run_20261111_093001';
    const added = await mauto([
      'result', 'add-assertion', '--run-id', agentRun, '--scenario-id', 'demo', '--step-id', 'tap_more',
      '--assertion-id', 'more_there', '--type', 'element_exists', '--pass', 'true',
    ]);
    expect(added.exitKind).toBe('ok');
    const finalized = await mauto(['result', 'finalize', '--run-id', agentRun, '--scenario', file]);
    expect(finalized.exitKind).toBe('ok');
    expect(ran.envelope.data.executor.scenario_path).toBe(path.join('scenarios', 'demo.json'));
    expect(finalized.envelope.data.executor.scenario_path).toBe(ran.envelope.data.executor.scenario_path);
  });

  test('--pass false: finalize is test_failed (exit 6), failed', async () => {
    const { finalized, onDisk } = await runThenComplete('false');
    expect(finalized.exitKind).toBe('test_failed');
    expect(exitCodeFor(finalized.exitKind)).toBe(6);
    expect(onDisk.status).toBe('failed');
    expect(onDisk.assertion_results[1]).toMatchObject({ assertion_id: 'looks', status: 'failed', judge: { by: 'agent' } });
    expect(onDisk.executor.kind).toBe('runner');
  });
});

// #281: --update-references reaches the runner, which records the baseline.
describe('mauto run --update-references', () => {
  const { solidPng } = require('../../helpers/png');
  const shotScenario = () => scenario({
    assertions: [{ id: 'home_shot', after_step: 'tap_more', type: 'screenshot_match', description: 'd' }],
  });
  const refPath = () => path.join(root, '.mobile-automator', 'screenshots', 'reference', 'demo', 'home_shot.png');
  const shotBridge = () => makeFakeBridge({ elements: [homeElements()], screenshots: [solidPng(12, 12)] });

  test('records the reference and passes', async () => {
    const file = writeScenario(shotScenario());
    const { r } = await runCli([file, '--run-id', RUN_ID, '--update-references'], { bridge: shotBridge() });
    expect(r.exitKind).toBe('ok');
    expect(fs.readFileSync(refPath())).toEqual(solidPng(12, 12));
  });

  test('without it, a missing reference leaves the run incomplete', async () => {
    const file = writeScenario(shotScenario());
    const { r } = await runCli([file, '--run-id', RUN_ID], { bridge: shotBridge() });
    expect(r.exitKind).toBe('incomplete');
    expect(fs.existsSync(refPath())).toBe(false);
  });
});
