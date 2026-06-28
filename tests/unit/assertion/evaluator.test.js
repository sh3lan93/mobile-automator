'use strict';

const {
  MECHANICAL_TYPES,
  evaluate,
} = require('../../../src/assertion/evaluator');

// Agnostic element fixtures (shape produced by ElementModel.normalize).
function el(text, extra = {}) {
  return {
    text,
    accessibility_label: null,
    bounds: [0, 0, 10, 10],
    center: [5, 5],
    type: null,
    ...extra,
  };
}

describe('MECHANICAL_TYPES', () => {
  test('is the Tier-1 set from the executor SKILL', () => {
    expect(MECHANICAL_TYPES.has('element_exists')).toBe(true);
    expect(MECHANICAL_TYPES.has('element_not_exists')).toBe(true);
    expect(MECHANICAL_TYPES.has('element_visible')).toBe(true);
    expect(MECHANICAL_TYPES.has('element_text')).toBe(true);
    expect(MECHANICAL_TYPES.has('text_contains')).toBe(true);
    expect(MECHANICAL_TYPES.has('text_not_empty')).toBe(true);
    expect(MECHANICAL_TYPES.has('element_hint')).toBe(true);
    expect(MECHANICAL_TYPES.has('pattern_match')).toBe(true);
    expect(MECHANICAL_TYPES.has('element_count')).toBe(true);
    expect(MECHANICAL_TYPES.has('list_item_count')).toBe(true);
    expect(MECHANICAL_TYPES.has('list_is_empty')).toBe(true);
    expect(MECHANICAL_TYPES.has('content_description')).toBe(true);
    expect(MECHANICAL_TYPES.has('has_accessibility_label')).toBe(true);
    expect(MECHANICAL_TYPES.has('value_matches_variable')).toBe(true);
    expect(MECHANICAL_TYPES.has('text_changed')).toBe(true);
    // Tier 2 must NOT be mechanical.
    expect(MECHANICAL_TYPES.has('screenshot_match')).toBe(false);
    expect(MECHANICAL_TYPES.has('element_fully_visible')).toBe(false);
    expect(MECHANICAL_TYPES.has('color_style')).toBe(false);
  });
});

describe('evaluate — mechanical types', () => {
  test('element_exists passes when a matching element is present', () => {
    const r = evaluate(
      { type: 'element_exists', target: 'Login' },
      { elements: [el('Login'), el('Cancel')] }
    );
    expect(r.type).toBe('element_exists');
    expect(r.mechanical).toBe(true);
    expect(r.needs_agent).toBe(false);
    expect(r.pass).toBe(true);
  });

  test('element_exists fails when no element matches', () => {
    const r = evaluate(
      { type: 'element_exists', target: 'Login' },
      { elements: [el('Cancel')] }
    );
    expect(r.pass).toBe(false);
    expect(r.mechanical).toBe(true);
  });

  test('element_not_exists passes when absent, fails when present', () => {
    expect(
      evaluate({ type: 'element_not_exists', target: 'Login' }, { elements: [el('Cancel')] }).pass
    ).toBe(true);
    expect(
      evaluate({ type: 'element_not_exists', target: 'Login' }, { elements: [el('Login')] }).pass
    ).toBe(false);
  });

  test('element_visible honors expected flag', () => {
    expect(
      evaluate(
        { type: 'element_visible', target: 'Login', expected: 'false' },
        { elements: [el('Cancel')] }
      ).pass
    ).toBe(true);
    expect(
      evaluate(
        { type: 'element_visible', target: 'Login' },
        { elements: [el('Login')] }
      ).pass
    ).toBe(true);
  });

  test('element_text exact match pass/fail (element located by accessibility label)', () => {
    expect(
      evaluate(
        { type: 'element_text', target: 'greeting', expected: 'Hello' },
        { elements: [el('Hello', { accessibility_label: 'greeting' })] }
      ).pass
    ).toBe(true);
    expect(
      evaluate(
        { type: 'element_text', target: 'greeting', expected: 'Hello' },
        { elements: [el('Hello World', { accessibility_label: 'greeting' })] }
      ).pass
    ).toBe(false);
  });

  test('text_contains substring pass/fail', () => {
    expect(
      evaluate(
        { type: 'text_contains', expected: 'ello' },
        { elements: [el('Hello World')] }
      ).pass
    ).toBe(true);
    expect(
      evaluate(
        { type: 'text_contains', expected: 'zzz' },
        { elements: [el('Hello World')] }
      ).pass
    ).toBe(false);
  });

  test('text_contains reads accessibility_label when text is null (agnostic apps)', () => {
    // Agnostic UIs (Flutter/RN/etc.) commonly expose visible content through
    // Semantics labels with no text node; content assertions must see it.
    const cartItem = el(null, { accessibility_label: 'Wireless Earbuds\nQty 1\n$59.99' });
    expect(
      evaluate(
        { type: 'text_contains', target: 'Wireless Earbuds', expected: 'Qty 1' },
        { elements: [cartItem] }
      ).pass
    ).toBe(true);
    expect(
      evaluate(
        { type: 'text_contains', target: 'Wireless Earbuds', expected: 'Qty 9' },
        { elements: [cartItem] }
      ).pass
    ).toBe(false);
  });

  test('text_not_empty', () => {
    expect(
      evaluate({ type: 'text_not_empty', target: 'Hello' }, { elements: [el('Hello')] }).pass
    ).toBe(true);
    // An element whose only content is its accessibility label counts as
    // non-empty in agnostic mode (the label is the displayed content).
    expect(
      evaluate({ type: 'text_not_empty', target: 'X' }, { elements: [el('', { accessibility_label: 'X' })] }).pass
    ).toBe(true);
  });

  test('pattern_match against element text', () => {
    expect(
      evaluate(
        { type: 'pattern_match', pattern: '^\\d{3}-\\d{4}$' },
        { elements: [el('123-4567')] }
      ).pass
    ).toBe(true);
    expect(
      evaluate(
        { type: 'pattern_match', pattern: '^\\d{3}-\\d{4}$' },
        { elements: [el('nope')] }
      ).pass
    ).toBe(false);
  });

  test('element_count with operator', () => {
    expect(
      evaluate(
        { type: 'element_count', target: 'Item', operator: '>=', count: 2 },
        { elements: [el('Item A'), el('Item B'), el('Other')] }
      ).pass
    ).toBe(true);
    expect(
      evaluate(
        { type: 'element_count', target: 'Item', operator: '==', count: 5 },
        { elements: [el('Item A')] }
      ).pass
    ).toBe(false);
  });

  test('list_is_empty', () => {
    expect(
      evaluate({ type: 'list_is_empty', target: 'Row' }, { elements: [el('Header')] }).pass
    ).toBe(true);
    expect(
      evaluate({ type: 'list_is_empty', target: 'Row' }, { elements: [el('Row 1')] }).pass
    ).toBe(false);
  });

  test('has_accessibility_label', () => {
    expect(
      evaluate(
        { type: 'has_accessibility_label', target: 'icon' },
        { elements: [el('icon', { accessibility_label: 'Settings' })] }
      ).pass
    ).toBe(true);
    expect(
      evaluate(
        { type: 'has_accessibility_label', target: 'icon' },
        { elements: [el('icon', { accessibility_label: null })] }
      ).pass
    ).toBe(false);
  });

  test('value_matches_variable compares captured variable to element text', () => {
    expect(
      evaluate(
        { type: 'value_matches_variable', target: 'order', variable_name: 'order_id' },
        { elements: [el('ORD-99', { accessibility_label: 'order' })], variables: { order_id: 'ORD-99' } }
      ).pass
    ).toBe(true);
    expect(
      evaluate(
        { type: 'value_matches_variable', target: 'order', variable_name: 'order_id' },
        { elements: [el('ORD-00', { accessibility_label: 'order' })], variables: { order_id: 'ORD-99' } }
      ).pass
    ).toBe(false);
  });

  test('text_changed compares against previous snapshot', () => {
    expect(
      evaluate(
        { type: 'text_changed', target: 'counter' },
        { elements: [el('2', { accessibility_label: 'counter' })], previous: [el('1', { accessibility_label: 'counter' })] }
      ).pass
    ).toBe(true);
    expect(
      evaluate(
        { type: 'text_changed', target: 'counter' },
        { elements: [el('1', { accessibility_label: 'counter' })], previous: [el('1', { accessibility_label: 'counter' })] }
      ).pass
    ).toBe(false);
  });
});

describe('evaluate — non-mechanical (needs agent)', () => {
  test('screenshot_match returns needs_agent with null pass', () => {
    const r = evaluate({ type: 'screenshot_match' }, { elements: [] });
    expect(r.mechanical).toBe(false);
    expect(r.needs_agent).toBe(true);
    expect(r.pass).toBeNull();
    expect(r.message).toMatch(/agent/i);
  });

  test('element_fully_visible needs agent', () => {
    const r = evaluate({ type: 'element_fully_visible', target: 'x' }, { elements: [el('x')] });
    expect(r.needs_agent).toBe(true);
    expect(r.pass).toBeNull();
  });

  test('an unknown/visual type is treated as needs_agent rather than crashing', () => {
    const r = evaluate({ type: 'color_style', target: 'x' }, { elements: [el('x')] });
    expect(r.needs_agent).toBe(true);
    expect(r.mechanical).toBe(false);
  });
});
