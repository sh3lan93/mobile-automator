'use strict';

// ResultStore#addStep persists needs_agent (R3), and crossCheck accepts the
// precondition_<n> step ids `mauto run` records.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { ResultStore } = require('../../../src/result/store');
const { crossCheck } = require('../../../src/result/scenario-check');
const { pendingHint } = require('../../../src/result/pending-hint');

describe('addStep needs_agent', () => {
  let root;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-step-na-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  test('persists needs_agent: true and the run finalizes incomplete', () => {
    const store = new ResultStore({ runId: 'run_20261112_130000', scenarioId: 's', projectRoot: root });
    store.addStep({ step_id: 'wifi', status: 'skipped', needs_agent: true, error_message: 'do it by hand' });
    const result = store.finalize();
    expect(result.steps_executed[0]).toMatchObject({ step_id: 'wifi', status: 'skipped', needs_agent: true });
    expect(result.status).toBe('incomplete');
  });

  test('absent by default: no needs_agent key', () => {
    const store = new ResultStore({ runId: 'run_20261112_130001', scenarioId: 's', projectRoot: root });
    store.addStep({ step_id: 'a', status: 'pass' });
    expect(store.finalize().steps_executed[0]).not.toHaveProperty('needs_agent');
  });

  test('the incomplete hint names the pending step and what to do', () => {
    const store = new ResultStore({ runId: 'run_20261112_130002', scenarioId: 's', projectRoot: root });
    store.addStep({ step_id: 'wifi', status: 'skipped', needs_agent: true, error_message: 'disable_wifi: turn Wi-Fi off by hand' });
    const hint = pendingHint(store.finalize(), { projectRoot: root });
    expect(hint).toContain('Pending step wifi: disable_wifi: turn Wi-Fi off by hand');
  });
});

describe('addStep resolves a needs_agent step (#329)', () => {
  let root;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-step-resolve-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  // What `mauto run` leaves behind: a step before the pending one, the pending
  // step, and a finalized `incomplete` file.
  const pendingRun = (runId) => {
    const store = new ResultStore({ runId, scenarioId: 's', projectRoot: root });
    store.addStep({ step_id: 'launch', status: 'pass' });
    store.addStep({ step_id: 'install', status: 'skipped', needs_agent: true, error_message: 'install the app by hand' });
    expect(store.finalize().status).toBe('incomplete');
    return runId;
  };

  test('a decided record replaces the needs_agent record in place, and the run can pass', () => {
    const runId = pendingRun('run_20261117_120000');
    const store = new ResultStore({ runId, projectRoot: root });
    const step = store.addStep({ step_id: 'install', status: 'pass' });
    expect(step).not.toHaveProperty('needs_agent');
    store.addStep({ step_id: 'tap_next', status: 'pass' });
    const result = store.finalize();
    expect(result.steps_executed.map((s) => [s.step_id, s.status, s.needs_agent])).toEqual([
      ['launch', 'passed', undefined],
      ['install', 'passed', undefined],
      ['tap_next', 'passed', undefined],
    ]);
    expect(result.status).toBe('passed');
  });

  test('the agent recording the pending step as failed fails the run', () => {
    const runId = pendingRun('run_20261117_120001');
    const store = new ResultStore({ runId, projectRoot: root });
    store.addStep({ step_id: 'install', status: 'fail', error_message: 'the build would not install' });
    const result = store.finalize();
    expect(result.steps_executed).toHaveLength(2);
    expect(result.status).toBe('failed');
  });

  test('a decided step is never replaced: a second record for it still appends', () => {
    const store = new ResultStore({ runId: 'run_20261117_120002', scenarioId: 's', projectRoot: root });
    store.addStep({ step_id: 'tap', status: 'fail' });
    store.addStep({ step_id: 'tap', status: 'pass' });
    expect(store.finalize().steps_executed.map((s) => s.status)).toEqual(['failed', 'passed']);
  });

  test('a record for another step id leaves the pending step pending', () => {
    const runId = pendingRun('run_20261117_120003');
    const store = new ResultStore({ runId, projectRoot: root });
    store.addStep({ step_id: 'tap_next', status: 'pass' });
    expect(store.finalize().status).toBe('incomplete');
  });

  test('the hint gives the add-step line that resolves the pending step', () => {
    const runId = pendingRun('run_20261117_120004');
    const hint = pendingHint(new ResultStore({ runId, projectRoot: root }).finalize(), { projectRoot: root });
    expect(hint).toContain('Pending step install: install the app by hand');
    expect(hint).toContain(`mauto result add-step --run-id ${runId} --step-id install --status <pass|fail>`);
    expect(hint).toMatch(/steps after it did not run/);
  });
});

describe('crossCheck and precondition steps', () => {
  const scenario = {
    scenario_id: 'demo',
    steps: [{ id: 'launch', action: 'launch_app' }],
    assertions: [],
    preconditions: { device_actions: [{ action: 'uninstall_app' }, { action: 'set_orientation', value: 'portrait' }] },
  };
  const recorded = (ids) => ({ scenario_id: 'demo', steps: ids.map((step_id) => ({ step_id })), assertions: [] });

  test('precondition_<n> within the scenario device_actions is known', () => {
    expect(crossCheck(recorded(['precondition_1', 'precondition_2', 'launch']), scenario)).toEqual([]);
  });

  test('precondition_<n> beyond the list is a problem', () => {
    expect(crossCheck(recorded(['precondition_3']), scenario)).toEqual(['step "precondition_3" is not in the scenario']);
  });

  test('precondition_0 and malformed ids are problems', () => {
    expect(crossCheck(recorded(['precondition_0', 'precondition_x']), scenario)).toHaveLength(2);
  });

  test('a scenario without preconditions knows none', () => {
    expect(crossCheck(recorded(['precondition_1']), { scenario_id: 'demo', steps: [], assertions: [] })).toEqual([
      'step "precondition_1" is not in the scenario',
    ]);
  });
});
