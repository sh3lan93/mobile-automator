'use strict';

const { substitute, substituteStep, substituteAssertion, UndefinedVariableError } = require('../../../src/run/variables');

const vars = { order_id: 'A-17', total: '9.50' };

describe('substitute', () => {
  test('replaces every reference', () => {
    expect(substitute('Order ${order_id} costs ${total} (${order_id})', vars)).toBe('Order A-17 costs 9.50 (A-17)');
  });

  test('text without references is untouched', () => {
    expect(substitute('plain $ {x} ${Bad} $', vars)).toBe('plain $ {x} ${Bad} $');
  });

  test('a name with no value throws a fatal error naming it', () => {
    expect.assertions(3);
    try {
      substitute('${ghost}', vars);
    } catch (err) {
      expect(err).toBeInstanceOf(UndefinedVariableError);
      expect(err.fatal).toBe(true);
      expect(err.message).toContain('"ghost"');
    }
  });

  test('a captured empty string is a value', () => {
    expect(substitute('[${a}]', { a: '' })).toBe('[]');
  });
});

describe('substituteStep', () => {
  test('substitutes value and target only', () => {
    const step = { id: 's', action: 'type', description: 'about ${order_id}', value: '${order_id}', target: 'Field ${total}', cold: true };
    expect(substituteStep(step, vars)).toEqual({ ...step, value: 'A-17', target: 'Field 9.50' });
  });

  test('a non-string value passes through', () => {
    expect(substituteStep({ id: 's', value: 500 }, vars).value).toBe(500);
  });

  test('does not mutate the scenario step', () => {
    const step = { id: 's', value: '${order_id}' };
    substituteStep(step, vars);
    expect(step.value).toBe('${order_id}');
  });
});

describe('substituteAssertion', () => {
  test('substitutes string fields but not the naming ones', () => {
    const a = {
      id: 'a_${order_id}', type: 'element_text', after_step: 's', description: 'shows ${order_id}', variable_name: 'order_id',
      element_description: 'Order', expected_value: '${order_id}', pattern: 'x${total}', expected_count: 3,
    };
    expect(substituteAssertion(a, vars)).toEqual({ ...a, expected_value: 'A-17', pattern: 'x9.50' });
  });
});
