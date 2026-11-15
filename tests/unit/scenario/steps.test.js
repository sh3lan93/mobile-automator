'use strict';

const { flattenSteps } = require('../../../src/scenario/steps');

describe('flattenSteps', () => {
  test('lists every step depth-first in document order with its path', () => {
    const a = { id: 'a', action: 'launch_app' };
    const k1 = { id: 'k1', action: 'press_back' };
    const g = { id: 'g', action: 'press_back' };
    const k2 = { id: 'k2', action: 'press_back', sub_steps: [g] };
    const b = { id: 'b', action: 'tap', sub_steps: [k1, k2] };
    const c = { id: 'c', action: 'press_back' };
    const entries = flattenSteps({ steps: [a, b, c] });
    expect(entries.map((e) => [e.step, e.path])).toEqual([
      [a, 'steps[0]'],
      [b, 'steps[1]'],
      [k1, 'steps[1].sub_steps[0]'],
      [k2, 'steps[1].sub_steps[1]'],
      [g, 'steps[1].sub_steps[1].sub_steps[0]'],
      [c, 'steps[2]'],
    ]);
  });

  test('only the first top-level step is isFirstTopLevel', () => {
    const entries = flattenSteps({
      steps: [{ id: 'a', action: 'launch_app', sub_steps: [{ id: 'k', action: 'launch_app' }] }, { id: 'b' }],
    });
    expect(entries.map((e) => e.isFirstTopLevel)).toEqual([true, false, false]);
  });

  test('skips null steps without shifting the paths of the rest', () => {
    const entries = flattenSteps({ steps: [null, { id: 'a' }] });
    expect(entries.map((e) => [e.path, e.isFirstTopLevel])).toEqual([['steps[1]', false]]);
  });

  test('tolerates a missing scenario, missing steps and non-array sub_steps', () => {
    expect(flattenSteps(undefined)).toEqual([]);
    expect(flattenSteps({})).toEqual([]);
    expect(flattenSteps({ steps: 'x' })).toEqual([]);
    expect(flattenSteps({ steps: [{ id: 'a', sub_steps: 'x' }] }).map((e) => e.path)).toEqual(['steps[0]']);
  });
});
