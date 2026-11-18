'use strict';

// The reverse of crossCheck (#335): what a scenario declares that the run never
// recorded. `result finalize --scenario` reads a run with gaps `incomplete`.

const { unrecordedEntries } = require('../../../src/result/scenario-check');

const SCENARIO = {
  scenario_id: 'login',
  preconditions: { device_actions: [{ action: 'uninstall_app' }, { action: 'install_app', value: 'a.apk' }] },
  steps: [
    { id: 'launch', action: 'launch_app' },
    {
      id: 'login_flow', action: 'tap',
      sub_steps: [
        { id: 'type_user', action: 'type_text', sub_steps: [{ id: 'deep', action: 'tap' }] },
        { id: 'type_pass', action: 'type_text' },
      ],
    },
    { id: 'tap', action: 'tap' },
  ],
  assertions: [
    { id: 'launched', type: 'element_exists', after_step: 'launch' },
    { id: 'logged_in', type: 'element_exists', after_step: 'tap' },
  ],
};

const ALL_STEPS = ['precondition_1', 'precondition_2', 'launch', 'login_flow', 'tap'];
const recorded = (steps, assertions = ['launched', 'logged_in']) => ({
  scenario_id: 'login',
  steps: steps.map((step_id) => ({ step_id, status: 'passed' })),
  assertions: assertions.map((assertion_id) => ({ assertion_id, status: 'passed' })),
});

describe('unrecordedEntries (#335)', () => {
  test('nothing missing -> empty lists', () => {
    expect(unrecordedEntries(recorded(ALL_STEPS), SCENARIO)).toEqual({ steps: [], assertions: [] });
  });

  test('the issue repro: a later step and its assertion never recorded', () => {
    const scenario = {
      scenario_id: 's',
      steps: [{ id: 'launch', action: 'launch_app' }, { id: 'tap', action: 'tap' }],
      assertions: [{ id: 'shown', type: 'element_exists', after_step: 'tap' }],
    };
    expect(unrecordedEntries(recorded(['launch'], []), scenario)).toEqual({ steps: ['tap'], assertions: ['shown'] });
  });

  test('preconditions are declared steps, in document order before the steps', () => {
    expect(unrecordedEntries(recorded(['launch', 'login_flow', 'tap']), SCENARIO)).toEqual({
      steps: ['precondition_1', 'precondition_2'],
      assertions: [],
    });
  });

  test('sub-steps are covered by a record of their parent', () => {
    expect(unrecordedEntries(recorded(ALL_STEPS), SCENARIO).steps).toEqual([]);
  });

  test('a parent is covered by individual records of its sub-steps', () => {
    const r = recorded(['precondition_1', 'precondition_2', 'launch', 'type_user', 'type_pass', 'tap']);
    expect(unrecordedEntries(r, SCENARIO).steps).toEqual([]);
  });

  test('a deep record covers its ancestors and descendants, not their other branches', () => {
    const r = recorded(['precondition_1', 'precondition_2', 'launch', 'deep', 'tap']);
    expect(unrecordedEntries(r, SCENARIO).steps).toEqual(['type_pass']);
  });

  test('a sibling sub-step stays unrecorded when only one sub-step was recorded', () => {
    const r = recorded(['precondition_1', 'precondition_2', 'launch', 'type_pass', 'tap']);
    expect(unrecordedEntries(r, SCENARIO).steps).toEqual(['type_user', 'deep']);
  });

  test('a step recorded skipped counts as recorded', () => {
    const r = recorded(ALL_STEPS);
    r.steps.find((s) => s.step_id === 'tap').status = 'skipped';
    expect(unrecordedEntries(r, SCENARIO)).toEqual({ steps: [], assertions: [] });
  });

  test('missing assertions are listed in document order', () => {
    expect(unrecordedEntries(recorded(ALL_STEPS, []), SCENARIO).assertions).toEqual(['launched', 'logged_in']);
  });

  test('a scenario declaring nothing has nothing unrecorded', () => {
    expect(unrecordedEntries(recorded([], []), { scenario_id: 'e', steps: [] })).toEqual({ steps: [], assertions: [] });
  });

  test('a precondition is covered only by its own id', () => {
    const r = recorded(['precondition_2', 'launch', 'login_flow', 'tap']);
    expect(unrecordedEntries(r, SCENARIO).steps).toEqual(['precondition_1']);
  });
});
