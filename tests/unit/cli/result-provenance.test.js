'use strict';

// `result add-assertion --pass pending --judge` and `result finalize
// --scenario` (#275), driven the way withEnvelope drives the handlers: a
// returned result stands, a thrown error goes through toEnvelope.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { handleResultAddAssertion, handleResultAddStep, handleResultFinalize, toEnvelope } = require('../../../src/cli');
const { ResultStore } = require('../../../src/result/store');
const { ScenarioValidator } = require('../../../src/scenario/validator');
const { exitCodeFor } = require('../../../src/output/envelope');
const { version } = require('../../../package.json');

const validator = new ScenarioValidator();

const SCENARIO = {
  $schema_version: '2.1',
  scenario_id: 'login_smoke',
  name: 'Login smoke',
  description: 'Verifies the login screen.',
  platform: 'cross-platform',
  app_package: 'com.example.app',
  metadata: { app_version: 'staging-latest', environment: 'staging' },
  steps: [{ id: 'launch', action: 'launch_app', description: 'Launch the app' }],
  assertions: [
    { id: 'login_visible', after_step: 'launch', type: 'element_exists', description: 'Login present' },
    { id: 'looks_right', after_step: 'launch', type: 'visual_state', description: 'Looks right' },
  ],
};

let n = 0;
function setup() {
  n += 1;
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-cli-prov-'));
  const deps = { resultStoreFactory: (o) => new ResultStore(o), projectRoot, validator };
  const runId = `run_20261111_1400${String(n).padStart(2, '0')}`;
  const file = path.join(projectRoot, '.mobile-automator', 'results', `${runId}.json`);
  return { deps, runId, file, projectRoot };
}

function invoke(fn) {
  try {
    return fn();
  } catch (err) {
    return toEnvelope(err);
  }
}

function writeScenario(dir, doc = SCENARIO) {
  const p = path.join(dir, 'login.json');
  fs.writeFileSync(p, JSON.stringify(doc, null, 2));
  return p;
}

const add = (deps, runId, over) =>
  invoke(() => handleResultAddAssertion(deps, { runId, scenarioId: 'login_smoke', stepId: 'launch', ...over }));

describe('result add-assertion --pass / --judge (#275)', () => {
  test('--pass pending records needs_agent with judge none, type and step', () => {
    const { deps, runId } = setup();
    const r = add(deps, runId, { type: 'visual_state', assertionId: 'looks_right', pass: 'pending' });
    expect(r.exitKind).toBe('ok');
    expect(r.envelope.data.assertion).toMatchObject({
      assertion_id: 'looks_right', status: 'needs_agent', type: 'visual_state', step_id: 'launch',
      mechanical: false, judge: { by: 'none' },
    });
  });

  test('a decided verdict with no --judge records no judge (callers before #275 unchanged)', () => {
    const { deps, runId } = setup();
    const r = add(deps, runId, { type: 'element_exists', assertionId: 'login_visible', pass: 'true' });
    expect(r.envelope.data.assertion).not.toHaveProperty('judge');
    expect(r.envelope.data.assertion).toMatchObject({ type: 'element_exists', step_id: 'launch', mechanical: true });
  });

  test('--judge agent with a verdict decides the pending entry in place', () => {
    const { deps, runId, file } = setup();
    add(deps, runId, { type: 'visual_state', assertionId: 'looks_right', pass: 'pending' });
    const r = add(deps, runId, { type: 'visual_state', assertionId: 'looks_right', pass: 'true', judge: 'agent', message: 'matches' });
    expect(r.exitKind).toBe('ok');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')).assertion_results;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ status: 'passed', judge: { by: 'agent' }, message: 'matches' });
  });

  test.each([
    [{ pass: 'pending', judge: 'agent' }, /--judge agent needs a verdict/],
    [{ pass: 'true', judge: 'none' }, /--judge none means nobody decided/],
    [{ pass: 'true', judge: 'mauto' }, /--judge must be agent \| none/],
    [{ pass: 'maybe' }, /--pass must be true \| false \| pending/],
  ])('%p -> invalid_input, nothing written', (flags, message) => {
    const { deps, runId, file } = setup();
    const r = add(deps, runId, { type: 'visual_state', assertionId: 'looks_right', ...flags });
    expect(r.exitKind).toBe('invalid_input');
    expect(r.envelope.error.message).toMatch(message);
    expect(fs.existsSync(file)).toBe(false);
  });

  test('pending over a decided assertion -> invalid_input with a hint, file unchanged', () => {
    const { deps, runId, file } = setup();
    add(deps, runId, { type: 'visual_state', assertionId: 'looks_right', pass: 'false', judge: 'agent' });
    const before = fs.readFileSync(file, 'utf8');
    const r = add(deps, runId, { type: 'visual_state', assertionId: 'looks_right', pass: 'pending' });
    expect(r.exitKind).toBe('invalid_input');
    expect(r.envelope.error.message).toMatch(/already decided \(failed\)/);
    expect(r.envelope.hint).toMatch(/--pass true\|false/);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });
});

describe('result finalize --scenario and incomplete (#275)', () => {
  test('a pending assertion finalizes incomplete: exit 7, the hint lists the exact commands', () => {
    const { deps, runId } = setup();
    add(deps, runId, { type: 'visual_state', assertionId: 'looks_right', pass: 'pending' });
    const f = invoke(() => handleResultFinalize(deps, { runId }));
    expect(f.exitKind).toBe('incomplete');
    expect(exitCodeFor(f.exitKind)).toBe(7);
    expect(f.envelope.error).toEqual({ kind: 'incomplete', message: `run ${runId} incomplete: 1 assertion(s) need agent judgment` });
    expect(f.envelope.data.status).toBe('incomplete');
    expect(f.envelope.hint).toContain(
      `mauto result add-assertion --run-id ${runId} --step-id launch --assertion-id looks_right --type visual_state --pass <true|false> --judge agent --message "<why>"`
    );
    expect(f.envelope.hint).toContain(`mauto result finalize --run-id ${runId} --scenario <scenario.json>`);
  });

  test('without --scenario: an agent executor with null scenario fields is written', () => {
    const { deps, runId } = setup();
    add(deps, runId, { type: 'element_exists', assertionId: 'login_visible', pass: 'true' });
    const f = invoke(() => handleResultFinalize(deps, { runId }));
    expect(f.exitKind).toBe('ok');
    expect(f.envelope.data.executor).toMatchObject({
      kind: 'agent', mauto_version: version, platform: null, device_id: null,
      scenario_path: null, scenario_sha256: null, mode: 'platform-aware',
    });
  });

  test('a matching --scenario hashes the file into the executor', () => {
    const { deps, runId, projectRoot } = setup();
    const scenarioPath = writeScenario(projectRoot);
    add(deps, runId, { type: 'element_exists', assertionId: 'login_visible', pass: 'true' });
    const f = invoke(() => handleResultFinalize(deps, { runId, scenario: scenarioPath }));
    expect(f.exitKind).toBe('ok');
    const sha = require('crypto').createHash('sha256').update(fs.readFileSync(scenarioPath)).digest('hex');
    expect(f.envelope.data.executor).toMatchObject({ kind: 'agent', scenario_path: 'login.json', scenario_sha256: sha });
  });

  // --scenario resolves against the cwd the verb ran in, which is not the
  // project root when the user stands in a subdirectory (the workspace is
  // discovered by walking up). Recorded relative to the root regardless.
  test('a relative --scenario from a subdirectory resolves against the cwd, recorded relative to the root', () => {
    const { deps, runId, projectRoot } = setup();
    const scenarioPath = writeScenario(projectRoot);
    const cwd = path.join(projectRoot, 'sub');
    fs.mkdirSync(cwd);
    add(deps, runId, { type: 'element_exists', assertionId: 'login_visible', pass: 'true' });
    const f = invoke(() => handleResultFinalize({ ...deps, cwd }, { runId, scenario: path.join('..', 'sub', '..', 'login.json') }));
    expect(f.exitKind).toBe('ok');
    const sha = require('crypto').createHash('sha256').update(fs.readFileSync(scenarioPath)).digest('hex');
    expect(f.envelope.data.executor).toMatchObject({ scenario_path: 'login.json', scenario_sha256: sha });
  });

  test('the incomplete hint names the scenario absolutely; re-finalizing with it from a subdirectory passes', () => {
    const { deps, runId, projectRoot } = setup();
    const scenarioPath = writeScenario(projectRoot);
    const cwd = path.join(projectRoot, 'sub');
    fs.mkdirSync(cwd);
    const inSub = { ...deps, cwd };
    handleResultAddStep(deps, { runId, scenarioId: 'login_smoke', stepId: 'launch', status: 'pass' });
    add(deps, runId, { type: 'element_exists', assertionId: 'login_visible', pass: 'true' });
    add(deps, runId, { type: 'visual_state', assertionId: 'looks_right', pass: 'pending' });
    const first = invoke(() => handleResultFinalize(inSub, { runId, scenario: path.join('..', 'login.json') }));
    expect(first.exitKind).toBe('incomplete');
    const hinted = first.envelope.hint.split('\n').at(-1).match(/--scenario (\S+)$/)[1];
    expect(path.isAbsolute(hinted)).toBe(true);
    expect(hinted).toBe(scenarioPath);
    expect(fs.existsSync(hinted)).toBe(true);

    add(deps, runId, { type: 'visual_state', assertionId: 'looks_right', pass: 'true', judge: 'agent', message: 'ok' });
    // The sha check passes: the relative path from the subdirectory loads the
    // same file the first finalize hashed.
    const again = invoke(() => handleResultFinalize(inSub, { runId, scenario: path.join('..', 'login.json') }));
    expect(again.exitKind).toBe('ok');
    expect(again.envelope.data).toMatchObject({ status: 'passed', executor: { scenario_path: 'login.json' } });
  });

  test('the full loop: pending -> 7 -> decide with --judge agent -> finalize --scenario -> passed', () => {
    const { deps, runId, projectRoot } = setup();
    const scenarioPath = writeScenario(projectRoot);
    handleResultAddStep(deps, { runId, scenarioId: 'login_smoke', stepId: 'launch', status: 'pass' });
    add(deps, runId, { type: 'element_exists', assertionId: 'login_visible', pass: 'true' });
    add(deps, runId, { type: 'visual_state', assertionId: 'looks_right', pass: 'pending' });
    expect(invoke(() => handleResultFinalize(deps, { runId, scenario: scenarioPath })).exitKind).toBe('incomplete');

    add(deps, runId, { type: 'visual_state', assertionId: 'looks_right', pass: 'true', judge: 'agent', message: 'ok' });
    const f = invoke(() => handleResultFinalize(deps, { runId, scenario: scenarioPath }));
    expect(f.exitKind).toBe('ok');
    expect(f.envelope.data).toMatchObject({ status: 'passed', total_assertions: 2, passed_assertions: 2 });
  });

  test.each([
    ['an unknown assertion id', (deps, runId) => add(deps, runId, { type: 'element_exists', assertionId: 'made_up', pass: 'true' }), /assertion "made_up"/],
    ['an unknown step id', (deps, runId) => handleResultAddStep(deps, { runId, scenarioId: 'login_smoke', stepId: 'ghost', status: 'pass' }), /step "ghost"/],
    ['another scenario id', (deps, runId) => handleResultAddStep(deps, { runId, scenarioId: 'checkout', stepId: 'launch', status: 'pass' }), /scenario_id "checkout"/],
  ])('%s -> invalid_input with data.problems, the file byte-for-byte unchanged', (_name, record, problem) => {
    const { deps, runId, file, projectRoot } = setup();
    record(deps, runId);
    const before = fs.readFileSync(file, 'utf8');
    const f = invoke(() => handleResultFinalize(deps, { runId, scenario: writeScenario(projectRoot) }));
    expect(f.exitKind).toBe('invalid_input');
    expect(f.envelope.data.problems.join('\n')).toMatch(problem);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  test('a scenario edited since the run -> invalid_input, nothing written', () => {
    const { deps, runId, file, projectRoot } = setup();
    const scenarioPath = writeScenario(projectRoot);
    add(deps, runId, { type: 'visual_state', assertionId: 'looks_right', pass: 'pending' });
    invoke(() => handleResultFinalize(deps, { runId, scenario: scenarioPath }));
    fs.writeFileSync(scenarioPath, JSON.stringify({ ...SCENARIO, description: 'edited' }, null, 2));
    const before = fs.readFileSync(file, 'utf8');

    const f = invoke(() => handleResultFinalize(deps, { runId, scenario: scenarioPath }));
    expect(f.exitKind).toBe('invalid_input');
    expect(f.envelope.error.message).toBe('the scenario changed since the run');
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  test('an unreadable --scenario -> invalid_input, nothing written', () => {
    const { deps, runId, file, projectRoot } = setup();
    add(deps, runId, { type: 'element_exists', assertionId: 'login_visible', pass: 'true' });
    const before = fs.readFileSync(file, 'utf8');
    const f = invoke(() => handleResultFinalize(deps, { runId, scenario: path.join(projectRoot, 'nope.json') }));
    expect(f.exitKind).toBe('invalid_input');
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  test('--status incomplete over nothing pending is refused, nothing written (B1)', () => {
    const { deps, runId, file } = setup();
    const f = invoke(() => handleResultFinalize(deps, { runId, status: 'incomplete' }));
    expect(f.exitKind).toBe('invalid_input');
    expect(fs.existsSync(file)).toBe(false);
  });

  test('--status incomplete is accepted and exits 7 when an assertion is pending', () => {
    const { deps, runId } = setup();
    add(deps, runId, { type: 'visual_state', assertionId: 'looks_right', pass: 'pending' });
    const f = invoke(() => handleResultFinalize(deps, { runId, status: 'incomplete' }));
    expect(f.exitKind).toBe('incomplete');
    expect(f.envelope.error.message).toMatch(`run ${runId} incomplete`);
  });

  test('re-finalize keeps the first executor', () => {
    const { deps, runId, file } = setup();
    add(deps, runId, { type: 'visual_state', assertionId: 'looks_right', pass: 'pending' });
    // A runner wrote the first finalize.
    const runner = { kind: 'runner', mauto_version: '0.0.1', engine: 'legacy', platform: 'android', device_id: 'emu', scenario_path: null, scenario_sha256: null, mode: 'platform-agnostic' };
    new ResultStore({ runId, projectRoot: deps.projectRoot }).finalize({ executor: runner });
    add(deps, runId, { type: 'visual_state', assertionId: 'looks_right', pass: 'true', judge: 'agent' });
    invoke(() => handleResultFinalize(deps, { runId }));
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).executor).toEqual(runner);
  });
});

// B1 (#275 review): an explicit --status may equal the derived one or make the
// run worse, never greener; refusals write nothing.
describe('result finalize --status never makes a run greener', () => {
  const finalize = (ctx, opts) => invoke(() => handleResultFinalize(ctx.deps, { runId: ctx.runId, ...opts }));

  test('passed over a needs_agent assertion is refused, nothing written', () => {
    const ctx = setup();
    add(ctx.deps, ctx.runId, { type: 'visual_state', assertionId: 'looks', pass: 'pending' });
    const before = fs.readFileSync(ctx.file, 'utf8');
    const f = finalize(ctx, { status: 'passed' });
    expect(f.exitKind).toBe('invalid_input');
    expect(f.envelope.error.message).toMatch(/incomplete/);
    expect(fs.readFileSync(ctx.file, 'utf8')).toBe(before);
  });

  test('passed over a failed step is refused', () => {
    const ctx = setup();
    new ResultStore({ runId: ctx.runId, projectRoot: ctx.projectRoot }).addStep({ step_id: 's1', status: 'fail' });
    expect(finalize(ctx, { status: 'passed' }).exitKind).toBe('invalid_input');
  });

  test('passed over an empty run is refused and nothing is written', () => {
    const ctx = setup();
    const f = finalize(ctx, { status: 'passed' });
    expect(f.exitKind).toBe('invalid_input');
    expect(f.envelope.error.message).toMatch(/nothing recorded/);
    expect(fs.existsSync(ctx.file)).toBe(false);
  });

  test('failed and error overrides stay allowed over a clean run', () => {
    for (const status of ['failed', 'error']) {
      const ctx = setup();
      new ResultStore({ runId: ctx.runId, projectRoot: ctx.projectRoot }).addStep({ step_id: 's1', status: 'pass' });
      const f = finalize(ctx, { status });
      expect(f.exitKind).toBe('test_failed');
      expect(JSON.parse(fs.readFileSync(ctx.file, 'utf8')).status).toBe(status);
    }
  });
});
