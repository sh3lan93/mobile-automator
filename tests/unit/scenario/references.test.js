'use strict';

const { findReplayWarnings, isBlocking, CODES } = require('../../../src/scenario/replayability');
const { REFERENCE_CODES } = require('../../../src/scenario/references');

const codesOf = (scenario) => findReplayWarnings(scenario).map((f) => f.code);
const only = (scenario, code) => findReplayWarnings(scenario).filter((f) => f.code === code);

describe('reference codes', () => {
  test('are merged into the replayability CODES', () => {
    for (const code of Object.keys(REFERENCE_CODES)) {
      expect(CODES[code]).toBe(REFERENCE_CODES[code]);
    }
  });

  test('missing_wait_config is advisory; the other five block --strict', () => {
    const blocking = Object.keys(REFERENCE_CODES).filter((c) => isBlocking({ code: c })).sort();
    expect(blocking).toEqual([
      'dangling_after_step',
      'dangling_condition_step',
      'duplicate_step_id',
      'missing_target',
      'undeclared_capture_variable',
    ]);
    expect(isBlocking({ code: 'missing_wait_config' })).toBe(false);
  });

  test('tolerates missing or malformed steps, assertions and variables', () => {
    expect(findReplayWarnings({})).toEqual([]);
    expect(findReplayWarnings({ steps: 'x', assertions: 'y', variables: 3 })).toEqual([]);
    expect(findReplayWarnings({ steps: [null], assertions: [null] })).toEqual([]);
  });
});

describe('duplicate_step_id', () => {
  test('reports every repeat after the first, naming the first path', () => {
    const w = only({
      steps: [
        { id: 'a', action: 'launch_app' },
        { id: 'a', action: 'press_back' },
        { id: 'a', action: 'press_back' },
      ],
    }, 'duplicate_step_id');
    expect(w.map((f) => f.path)).toEqual(['steps[1]', 'steps[2]']);
    expect(w[0]).toMatchObject({ step_id: 'a', action: 'press_back' });
    expect(w[0].message).toContain('steps[0]');
  });

  test('detects a repeat between the top level and sub_steps', () => {
    const w = only({
      steps: [
        { id: 'a', action: 'launch_app', sub_steps: [{ id: 'b', action: 'press_back' }] },
        { id: 'b', action: 'press_back' },
      ],
    }, 'duplicate_step_id');
    expect(w.map((f) => f.path)).toEqual(['steps[1]']);
    expect(w[0].message).toContain('steps[0].sub_steps[0]');
  });

  test('unique ids -> none', () => {
    expect(only({ steps: [{ id: 'a', action: 'launch_app' }, { id: 'b', action: 'press_back' }] },
      'duplicate_step_id')).toEqual([]);
  });
});

describe('dangling_after_step', () => {
  test('an assertion naming no step is reported with its assertion path and id', () => {
    const w = only({
      steps: [{ id: 's1', action: 'launch_app' }],
      assertions: [
        { id: 'ok', after_step: 's1', type: 'visual_state' },
        { id: 'bad', after_step: 'nope', type: 'visual_state' },
      ],
    }, 'dangling_after_step');
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ path: 'assertions[1]', assertion_id: 'bad' });
    expect(w[0]).not.toHaveProperty('step_id');
    expect(w[0]).not.toHaveProperty('action');
    expect(w[0].message).toContain('nope');
  });

  test('a step declared inside sub_steps is a valid after_step', () => {
    expect(only({
      steps: [{ id: 'p', action: 'launch_app', sub_steps: [{ id: 'kid', action: 'press_back' }] }],
      assertions: [{ id: 'a', after_step: 'kid', type: 'visual_state' }],
    }, 'dangling_after_step')).toEqual([]);
  });

  test('a missing after_step is dangling too', () => {
    expect(only({ steps: [], assertions: [{ id: 'a', type: 'visual_state' }] },
      'dangling_after_step')).toHaveLength(1);
  });
});

describe('missing_target', () => {
  const TARGET_ACTIONS = [
    'tap', 'long_press', 'double_tap', 'wait_for_element',
    'wait_for_element_gone', 'scroll_to_element', 'capture_value',
  ];
  const waitConfig = { type: 'element_visible', timeout_ms: 5000 };

  test.each(TARGET_ACTIONS)('%s without a target is reported', (action) => {
    const w = only({ steps: [{ id: 's', action, wait_config: waitConfig }] }, 'missing_target');
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ action, path: 'steps[0]', step_id: 's' });
  });

  test.each(TARGET_ACTIONS)('%s with a target is not', (action) => {
    expect(only({ steps: [{ id: 's', action, target: 'Login', wait_config: waitConfig }] },
      'missing_target')).toEqual([]);
  });

  test('target_pattern alone satisfies it', () => {
    expect(only({ steps: [{ id: 's', action: 'tap', target_pattern: '\\d+ points' }] },
      'missing_target')).toEqual([]);
  });

  test('an empty-string target is still missing', () => {
    expect(only({ steps: [{ id: 's', action: 'tap', target: '' }] }, 'missing_target')).toHaveLength(1);
  });

  test('actions that take no target are not reported', () => {
    expect(only({ steps: [{ id: 's', action: 'press_back' }, { id: 't', action: 'swipe' }] },
      'missing_target')).toEqual([]);
  });

  test('recurses into sub_steps', () => {
    const w = only({
      steps: [{ id: 'p', action: 'launch_app', sub_steps: [{ id: 'k', action: 'tap' }] }],
    }, 'missing_target');
    expect(w.map((f) => f.path)).toEqual(['steps[0].sub_steps[0]']);
  });
});

describe('undeclared_capture_variable', () => {
  test('capture_to not declared in root variables', () => {
    const w = only({
      variables: { total: { type: 'string', description: 'd' } },
      steps: [
        { id: 'a', action: 'capture_value', target: 'Total', capture_to: 'total' },
        { id: 'b', action: 'capture_value', target: 'Count', capture_to: 'count' },
      ],
    }, 'undeclared_capture_variable');
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ path: 'steps[1]', step_id: 'b' });
    expect(w[0].message).toContain('count');
  });

  test('condition.variable_name not declared (inside sub_steps)', () => {
    const w = only({
      steps: [{
        id: 'p', action: 'launch_app',
        sub_steps: [{ id: 'k', action: 'press_back', condition: { type: 'variable_value', variable_name: 'ghost' } }],
      }],
    }, 'undeclared_capture_variable');
    expect(w.map((f) => f.path)).toEqual(['steps[0].sub_steps[0]']);
    expect(w[0].message).toContain('ghost');
  });

  test('assertion variable_name not declared', () => {
    const w = only({
      steps: [{ id: 's', action: 'launch_app' }],
      assertions: [{ id: 'a', after_step: 's', type: 'value_matches_variable', variable_name: 'ghost' }],
    }, 'undeclared_capture_variable');
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ path: 'assertions[0]', assertion_id: 'a' });
  });

  test('declared variables are not reported', () => {
    expect(only({
      variables: { v: { type: 'string', description: 'd' } },
      steps: [
        { id: 'a', action: 'capture_value', target: 'T', capture_to: 'v' },
        { id: 'b', action: 'press_back', condition: { type: 'variable_value', variable_name: 'v' } },
      ],
      assertions: [{ id: 'x', after_step: 'a', type: 'value_matches_variable', variable_name: 'v' }],
    }, 'undeclared_capture_variable')).toEqual([]);
  });

  test('an inherited object key is not a declaration', () => {
    expect(only({ steps: [{ id: 'a', action: 'capture_value', target: 'T', capture_to: 'constructor' }] },
      'undeclared_capture_variable')).toHaveLength(1);
  });
});

describe('dangling_condition_step', () => {
  const skipped = (stepId) => ({ type: 'previous_step_skipped', step_id: stepId });

  test('an earlier step is fine', () => {
    expect(only({
      steps: [
        { id: 'a', action: 'launch_app' },
        { id: 'b', action: 'press_back', condition: skipped('a') },
      ],
    }, 'dangling_condition_step')).toEqual([]);
  });

  test('the parent of a sub_step precedes it', () => {
    expect(only({
      steps: [{ id: 'p', action: 'launch_app', sub_steps: [{ id: 'k', action: 'press_back', condition: skipped('p') }] }],
    }, 'dangling_condition_step')).toEqual([]);
  });

  test.each([
    ['unknown', 'nope'],
    ['self', 'b'],
    ['forward', 'c'],
  ])('%s step_id is reported', (_label, ref) => {
    const w = only({
      steps: [
        { id: 'a', action: 'launch_app' },
        { id: 'b', action: 'press_back', condition: skipped(ref) },
        { id: 'c', action: 'press_back' },
      ],
    }, 'dangling_condition_step');
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ path: 'steps[1]', step_id: 'b' });
    expect(w[0].message).toContain(ref);
  });

  test('a missing step_id is reported', () => {
    expect(only({ steps: [{ id: 'a', action: 'press_back', condition: { type: 'previous_step_skipped' } }] },
      'dangling_condition_step')).toHaveLength(1);
  });

  test('other condition types ignore step_id', () => {
    expect(only({ steps: [{ id: 'a', action: 'press_back', condition: { type: 'device_property', step_id: 'x' } }] },
      'dangling_condition_step')).toEqual([]);
  });
});

describe('missing_wait_config', () => {
  test.each(['wait_for_element', 'wait_for_element_gone', 'wait_for_loading_complete'])(
    '%s without wait_config is reported as advisory',
    (action) => {
      const w = only({ steps: [{ id: 'w', action, target: 'Spinner' }] }, 'missing_wait_config');
      expect(w).toHaveLength(1);
      expect(w[0]).toMatchObject({ action, path: 'steps[0]', step_id: 'w' });
      expect(isBlocking(w[0])).toBe(false);
    }
  );

  test('with wait_config -> none', () => {
    expect(only({
      steps: [{ id: 'w', action: 'wait_for_loading_complete', wait_config: { type: 'loading_complete', timeout_ms: 5000 } }],
    }, 'missing_wait_config')).toEqual([]);
  });
});

describe('ordering', () => {
  test('step findings interleave in document order, assertions come last', () => {
    const w = findReplayWarnings({
      steps: [
        { id: 'a', action: 'launch_app' },
        { id: 'b', action: 'tap', sub_steps: [{ id: 'a', action: 'press_back' }] },
        { id: 'c', action: 'wait_for_element', target: 'X' },
      ],
      assertions: [{ id: 'x', after_step: 'zzz', type: 'visual_state' }],
    });
    expect(w.map((f) => [f.code, f.path])).toEqual([
      ['missing_target', 'steps[1]'],
      ['duplicate_step_id', 'steps[1].sub_steps[0]'],
      ['missing_wait_config', 'steps[2]'],
      ['dangling_after_step', 'assertions[0]'],
    ]);
  });

  test('a scenario with no gaps yields no findings', () => {
    expect(codesOf({
      steps: [{ id: 'a', action: 'launch_app' }, { id: 'b', action: 'tap', target: 'Go' }],
      assertions: [{ id: 'x', after_step: 'b', type: 'visual_state' }],
    })).toEqual([]);
  });
});
