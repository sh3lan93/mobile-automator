'use strict';

const evaluator = require('../../../src/assertion/evaluator');
const { evaluateCondition } = require('../../../src/run/condition');
const { el } = require('../../helpers/fake-bridge');

function env(extra = {}) {
  return {
    platform: async () => 'android',
    orientation: async () => 'portrait',
    elements: async () => [el('Sample Shop'), el('Accept')],
    variables: { count: '42', flag: 'true', label: 'Pro' },
    statusOf: (id) => ({ dismiss: 'skipped', login: 'passed' })[id],
    evaluator,
    ...extra,
  };
}

const run = (condition, extra) => evaluateCondition(condition, env(extra));

describe('evaluateCondition truth table', () => {
  describe('device_property', () => {
    test.each([
      [{ property: 'platform', operator: '==', value: 'android' }, true],
      [{ property: 'platform', operator: '==', value: 'Android' }, true],
      [{ property: 'platform', operator: '==', value: 'ios' }, false],
      [{ property: 'platform', operator: '!=', value: 'ios' }, true],
      [{ property: 'platform', value: 'android' }, true],
      [{ property: 'orientation', operator: '==', value: 'portrait' }, true],
      [{ property: 'orientation', operator: '==', value: 'landscape' }, false],
      [{ property: 'orientation', operator: '!=', value: 'landscape' }, true],
    ])('%j -> %s', async (cond, expected) => {
      await expect(run({ type: 'device_property', ...cond })).resolves.toBe(expected);
    });

    test.each(['api_level', 'os_version', undefined])('property %s is left to the agent', async (property) => {
      await expect(run({ type: 'device_property', property, operator: '>=', value: 30 })).rejects.toMatchObject({
        needsAgent: true,
        message: expect.stringContaining('only platform and orientation'),
      });
    });

    test('reads only the probe the property names', async () => {
      const orientation = jest.fn();
      await run({ type: 'device_property', property: 'platform', value: 'android' }, { orientation });
      expect(orientation).not.toHaveBeenCalled();
    });
  });

  describe('previous_step_skipped', () => {
    test.each([
      ['dismiss', true],
      ['login', false],
      ['never_ran', false],
    ])('step %s -> %s', async (step_id, expected) => {
      await expect(run({ type: 'previous_step_skipped', step_id })).resolves.toBe(expected);
    });

    test('a condition naming no step is a fatal scenario error', async () => {
      await expect(run({ type: 'previous_step_skipped' })).rejects.toMatchObject({ fatal: true });
    });
  });

  describe('variable_value', () => {
    test.each([
      [{ variable_name: 'label', operator: '==', value: 'Pro' }, true],
      [{ variable_name: 'label', operator: '==', value: 'Free' }, false],
      [{ variable_name: 'label', operator: '!=', value: 'Free' }, true],
      [{ variable_name: 'count', operator: '>', value: 40 }, true],
      [{ variable_name: 'count', operator: '>=', value: 42 }, true],
      [{ variable_name: 'count', operator: '<', value: 42 }, false],
      [{ variable_name: 'count', operator: '<=', value: 42 }, true],
      [{ variable_name: 'count', operator: '==', value: 42 }, true],
      [{ variable_name: 'flag', operator: '==', value: true }, true],
      [{ variable_name: 'flag', operator: '==', value: false }, false],
      [{ variable_name: 'label', value: 'Pro' }, true],
    ])('%j -> %s', async (cond, expected) => {
      await expect(run({ type: 'variable_value', ...cond })).resolves.toBe(expected);
    });

    test('a variable nothing captured is a fatal scenario error', async () => {
      await expect(run({ type: 'variable_value', variable_name: 'ghost', value: 1 })).rejects.toMatchObject({ fatal: true });
    });
  });

  describe('element_visible', () => {
    test.each([
      [{ element_description: 'Accept' }, true],
      [{ element_description: 'Decline' }, false],
      [{ element_description: 'Accept', value: true }, true],
      [{ element_description: 'Accept', value: false }, false],
      [{ element_description: 'Decline', value: false }, true],
      [{ element_description: 'Decline', operator: '!=', value: true }, true],
    ])('%j -> %s', async (cond, expected) => {
      await expect(run({ type: 'element_visible', ...cond })).resolves.toBe(expected);
    });

    test('a condition naming no element is a fatal scenario error', async () => {
      await expect(run({ type: 'element_visible' })).rejects.toMatchObject({ fatal: true });
    });
  });

  test('an unknown type is a fatal scenario error', async () => {
    await expect(run({ type: 'moon_phase' })).rejects.toMatchObject({ fatal: true });
  });
});
