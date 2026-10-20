'use strict';

const { findUnsupportedActions } = require('../../src/scenario/replayability');
const { actionsByResolution } = require('../../src/device/action-catalog');

const UNSUPPORTED = actionsByResolution('unsupported');

describe('findUnsupportedActions', () => {
  test('clean scenario -> no findings', () => {
    const scenario = {
      steps: [{ id: 'a', action: 'launch_app' }, { id: 'b', action: 'long_press' }],
      preconditions: { device_actions: [{ action: 'uninstall_app' }] },
    };
    expect(findUnsupportedActions(scenario)).toEqual([]);
  });

  test('tolerates missing steps / preconditions / device_actions', () => {
    expect(findUnsupportedActions({})).toEqual([]);
    expect(findUnsupportedActions({ steps: [] })).toEqual([]);
    expect(findUnsupportedActions({ preconditions: {} })).toEqual([]);
  });

  test('unsupported step -> warning with steps[N] path and step_id', () => {
    const action = UNSUPPORTED[0];
    const w = findUnsupportedActions({
      steps: [{ id: 'ok', action: 'launch_app' }, { id: 'bad', action }],
    });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({
      code: 'unsupported_action',
      action,
      path: 'steps[1]',
      step_id: 'bad',
    });
    expect(w[0].message).toContain(action);
  });

  test('unsupported precondition device_action -> preconditions path, no step_id', () => {
    const action = UNSUPPORTED[0];
    const w = findUnsupportedActions({
      preconditions: { device_actions: [{ action: 'install_app' }, { action }] },
    });
    expect(w).toHaveLength(1);
    expect(w[0].path).toBe('preconditions.device_actions[1]');
    expect(w[0]).not.toHaveProperty('step_id');
  });

  test('multiple hits are reported steps first, then preconditions, in order', () => {
    const [a, b] = UNSUPPORTED;
    const w = findUnsupportedActions({
      steps: [{ id: 's0', action: a }, { id: 's1', action: 'launch_app' }, { id: 's2', action: b }],
      preconditions: { device_actions: [{ action: a }] },
    });
    expect(w.map((x) => x.path)).toEqual([
      'steps[0]',
      'steps[2]',
      'preconditions.device_actions[0]',
    ]);
  });

  test('unsupported action one level deep in sub_steps -> nested path and sub-step id', () => {
    const action = UNSUPPORTED[0];
    const w = findUnsupportedActions({
      steps: [{
        id: 'parent',
        action: 'tap',
        sub_steps: [{ id: 'ok', action: 'tap' }, { id: 'nested', action }],
      }],
    });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ action, path: 'steps[0].sub_steps[1]', step_id: 'nested' });
  });

  test('unsupported action two levels deep in sub_steps -> full nested path', () => {
    const action = UNSUPPORTED[0];
    const w = findUnsupportedActions({
      steps: [{
        id: 'p',
        action: 'tap',
        sub_steps: [
          { id: 'c0', action: 'tap' },
          { id: 'c1', action: 'tap', sub_steps: [{ id: 'gc', action }] },
        ],
      }],
    });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ action, path: 'steps[0].sub_steps[1].sub_steps[0]', step_id: 'gc' });
  });

  test('nested hits are depth-first in document order, then preconditions', () => {
    const [a, b] = UNSUPPORTED;
    const w = findUnsupportedActions({
      steps: [
        { id: 's0', action: a, sub_steps: [{ id: 's0a', action: b }] },
        { id: 's1', action: 'tap', sub_steps: [{ id: 's1a', action: a }] },
        { id: 's2', action: b },
      ],
      preconditions: { device_actions: [{ action: a }] },
    });
    expect(w.map((x) => x.path)).toEqual([
      'steps[0]',
      'steps[0].sub_steps[0]',
      'steps[1].sub_steps[0]',
      'steps[2]',
      'preconditions.device_actions[0]',
    ]);
  });

  test('every action the catalog marks unsupported is flagged', () => {
    expect(UNSUPPORTED.length).toBeGreaterThan(0);
    const w = findUnsupportedActions({
      steps: UNSUPPORTED.map((action, i) => ({ id: `s${i}`, action })),
    });
    expect(w.map((x) => x.action)).toEqual(UNSUPPORTED);
  });
});
