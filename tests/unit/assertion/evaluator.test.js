'use strict';

const fs = require('fs');
const path = require('path');

const {
  MECHANICAL_TYPES,
  SCREEN_SIZE_TYPES,
  evaluate,
} = require('../../../src/assertion/evaluator');
const { normalize, parseElements } = require('../../../src/device/element-model');

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
    // Promoted from the agent by R5a (#276).
    expect(MECHANICAL_TYPES.has('element_fully_visible')).toBe(true);
    expect(MECHANICAL_TYPES.has('screen_title')).toBe(true);
    expect(MECHANICAL_TYPES.has('permission_dialog_shown')).toBe(true);
    // Tier 2 must NOT be mechanical.
    expect(MECHANICAL_TYPES.has('screenshot_match')).toBe(false);
    expect(MECHANICAL_TYPES.has('alert_present')).toBe(false);
    expect(MECHANICAL_TYPES.has('alert_text')).toBe(false);
    expect(MECHANICAL_TYPES.has('color_style')).toBe(false);
  });

  test('SCREEN_SIZE_TYPES are the mechanical types that need the screen size', () => {
    expect([...SCREEN_SIZE_TYPES].sort()).toEqual(['element_fully_visible', 'screen_title']);
    for (const t of SCREEN_SIZE_TYPES) expect(MECHANICAL_TYPES.has(t)).toBe(true);
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

  test('alert_present and alert_text still need the agent', () => {
    for (const type of ['alert_present', 'alert_text']) {
      const r = evaluate({ type, target: 'x' }, { elements: [el('x')] });
      expect(r.needs_agent).toBe(true);
      expect(r.pass).toBeNull();
    }
  });

  test('an unknown/visual type is treated as needs_agent rather than crashing', () => {
    const r = evaluate({ type: 'color_style', target: 'x' }, { elements: [el('x')] });
    expect(r.needs_agent).toBe(true);
    expect(r.mechanical).toBe(false);
  });
});

// The real-device E2E harness (sample-app/scripts/lib/resolve.js) resolves tap
// targets through the CLI's OWN matcher rather than a copy of it, so a change
// to how `assert` matches is a change to how the harness taps. Pin the export.
describe('matcher exports (consumed by the real-device E2E harness, #94)', () => {
  const evaluator = require('../../../src/assertion/evaluator');

  test('matches and findFirst are exported functions', () => {
    expect(typeof evaluator.matches).toBe('function');
    expect(typeof evaluator.findFirst).toBe('function');
  });

  test('matches is a case-insensitive substring over text', () => {
    expect(evaluator.matches(el('Sample Shop'), 'sample shop')).toBe(true);
    expect(evaluator.matches(el('Sample Shop'), 'SHOP')).toBe(true);
    expect(evaluator.matches(el('Sample Shop'), 'Cart')).toBe(false);
  });

  test('matches falls back to the accessibility label when text is absent', () => {
    const nav = el(null, { accessibility_label: 'More\nTab 3 of 3' });
    expect(evaluator.matches(nav, 'more')).toBe(true);
    expect(evaluator.matches(nav, 'tab 3')).toBe(true);
  });

  test('findFirst returns the first match in list order, or null', () => {
    const header = el('More');
    const nav = el(null, { accessibility_label: 'More\nTab 3 of 3' });
    expect(evaluator.findFirst([header, nav], 'more')).toBe(header);
    expect(evaluator.findFirst([nav, header], 'more')).toBe(nav);
    expect(evaluator.findFirst([header, nav], 'Settings')).toBeNull();
  });
});

// R5a (#276): three types decided over the element list (+ the screen size).
const FIXTURES = path.join(__dirname, '..', '..', 'fixtures', 'device');
function engineElements(name) {
  return normalize(parseElements(fs.readFileSync(path.join(FIXTURES, 'mobile-mcp-1.0.13', name), 'utf8')));
}
function probeElements(name) {
  return normalize(JSON.parse(fs.readFileSync(path.join(FIXTURES, 'sample-app-probe', name), 'utf8')));
}
// android-default.screen.txt / ios-sim.screen.txt
const ANDROID_SCREEN = { width: 1280, height: 2856 };
const IOS_SCREEN = { width: 393, height: 852 };
const at = (text, bounds, extra = {}) => el(text, { bounds, ...extra });

describe('evaluate — element_fully_visible', () => {
  const screenSize = { width: 1000, height: 2000 };
  const ev = (elements, ss = screenSize) => evaluate({ type: 'element_fully_visible', target: 'Buy' }, { elements, screenSize: ss });

  test('passes when the element lies inside the screen', () => {
    const r = ev([at('Buy', [100, 100, 900, 200])]);
    expect(r.mechanical).toBe(true);
    expect(r.pass).toBe(true);
  });

  test('passes when the element touches the screen edges exactly', () => {
    expect(ev([at('Buy', [0, 0, 1000, 2000])]).pass).toBe(true);
  });

  test('fails when clipped by the right edge, naming bounds and screen size', () => {
    const r = ev([at('Buy', [800, 100, 1100, 200])]);
    expect(r.mechanical).toBe(true);
    expect(r.pass).toBe(false);
    expect(r.message).toContain('800,100,1100,200');
    expect(r.message).toContain('1000x2000');
  });

  test('fails when clipped by the bottom edge', () => {
    expect(ev([at('Buy', [100, 1900, 900, 2100])]).pass).toBe(false);
  });

  test('fails on negative coordinates (clipped by the top or left edge)', () => {
    expect(ev([at('Buy', [100, -40, 900, 60])]).pass).toBe(false);
    expect(ev([at('Buy', [-10, 100, 900, 200])]).pass).toBe(false);
  });

  test('fails when no element matches the target', () => {
    const r = ev([at('Cancel', [0, 0, 10, 10])]);
    expect(r.pass).toBe(false);
    expect(r.message).toMatch(/No element matching 'Buy'/);
  });

  test('fails mechanically when the screen size is unknown', () => {
    const r = ev([at('Buy', [100, 100, 900, 200])], null);
    expect(r.mechanical).toBe(true);
    expect(r.needs_agent).toBe(false);
    expect(r.pass).toBe(false);
    expect(r.message).toMatch(/screen size/i);
  });

  test('real sample-app Home screen: a visible category passes, an offstage page fails', () => {
    const elements = probeElements('home.mobilecli.raw.json');
    const visible = evaluate({ type: 'element_fully_visible', target: 'Electronics' }, { elements, screenSize: ANDROID_SCREEN });
    expect(visible.pass).toBe(true);
    // The probe's banner carousel page at [1260,324,1680,804] runs off the right edge.
    const offstage = elements.find((e) => e.bounds[0] === 1260 && e.bounds[2] === 1680);
    const clipped = evaluate(
      { type: 'element_fully_visible', target: 'Offstage page' },
      { elements: [{ ...offstage, accessibility_label: 'Offstage page' }], screenSize: ANDROID_SCREEN }
    );
    expect(clipped.pass).toBe(false);
  });
});

describe('evaluate — screen_title', () => {
  const screenSize = { width: 1000, height: 2000 };
  const ev = (expected, elements, ss = screenSize) => evaluate({ type: 'screen_title', expected }, { elements, screenSize: ss });

  test('passes when an element in the top quarter carries exactly the text', () => {
    const r = ev('Settings', [at('Settings', [40, 100, 400, 180])]);
    expect(r.mechanical).toBe(true);
    expect(r.pass).toBe(true);
  });

  test('fails when the same text sits lower on screen, saying where it was found', () => {
    const r = ev('Settings', [at('Settings', [40, 1500, 400, 1580])]);
    expect(r.pass).toBe(false);
    expect(r.message).toContain('1500');
  });

  test('the top edge must be above a quarter of the screen height', () => {
    expect(ev('Settings', [at('Settings', [0, 499, 10, 560])]).pass).toBe(true);
    expect(ev('Settings', [at('Settings', [0, 500, 10, 560])]).pass).toBe(false);
  });

  test('matches trimmed and case-insensitively, but not as a substring', () => {
    expect(ev('  settings ', [at('SETTINGS', [0, 10, 10, 20])]).pass).toBe(true);
    expect(ev('Settings', [at('Account Settings', [0, 10, 10, 20])]).pass).toBe(false);
  });

  test('matches an element that carries only an accessibility label', () => {
    expect(ev('Cart', [at(null, [0, 10, 10, 20], { accessibility_label: 'Cart' })]).pass).toBe(true);
  });

  test('fails naming the absence when nothing carries the text', () => {
    const r = ev('Settings', [at('Home', [0, 10, 10, 20])]);
    expect(r.pass).toBe(false);
    expect(r.message).toMatch(/no element/i);
  });

  test('fails mechanically when the screen size is unknown', () => {
    const r = ev('Settings', [at('Settings', [0, 10, 10, 20])], null);
    expect(r.mechanical).toBe(true);
    expect(r.pass).toBe(false);
    expect(r.message).toMatch(/screen size/i);
  });

  test('real engine output: the iOS Settings title (label-only) and the sample-app header pass', () => {
    expect(evaluate({ type: 'screen_title', expected: 'Settings' },
      { elements: engineElements('ios-sim.elements.txt'), screenSize: IOS_SCREEN }).pass).toBe(true);
    const home = probeElements('home.mobilecli.raw.json');
    expect(evaluate({ type: 'screen_title', expected: 'Sample Shop' }, { elements: home, screenSize: ANDROID_SCREEN }).pass).toBe(true);
    // Exact match only: a fragment of the title is not the title.
    expect(evaluate({ type: 'screen_title', expected: 'Sample' }, { elements: home, screenSize: ANDROID_SCREEN }).pass).toBe(false);
  });
});

describe('evaluate — permission_dialog_shown', () => {
  const ev = (elements, permission_name) => evaluate({ type: 'permission_dialog_shown', permission_name }, { elements });
  const dialog = (allow, deny, body = 'Allow Sample Shop to access your camera?') => [at(body, [0, 0, 1, 1]), at(allow, [0, 0, 1, 1]), at(deny, [0, 0, 1, 1])];

  test('passes when an allow and a deny button are both present', () => {
    const r = ev(dialog('While using the app', 'Deny'));
    expect(r.mechanical).toBe(true);
    expect(r.pass).toBe(true);
  });

  test('fails when only an allow button is present', () => {
    const r = ev([at('Allow', [0, 0, 1, 1])]);
    expect(r.pass).toBe(false);
    expect(r.message).toMatch(/deny/i);
  });

  test('matches the curly-apostrophe deny label', () => {
    expect(ev(dialog('Allow', 'Don’t Allow')).pass).toBe(true);
  });

  test('a button carrying only an accessibility label counts', () => {
    expect(ev([at(null, [0, 0, 1, 1], { accessibility_label: 'Allow Once' }), at("Don't Allow", [0, 0, 1, 1])]).pass).toBe(true);
  });

  test('with permission_name, some element must name the permission', () => {
    expect(ev(dialog('Allow', 'Deny'), 'Camera').pass).toBe(true);
    const r = ev(dialog('Allow', 'Deny'), 'location');
    expect(r.pass).toBe(false);
    expect(r.message).toContain('location');
  });

  test('needs no screen size', () => {
    expect(SCREEN_SIZE_TYPES.has('permission_dialog_shown')).toBe(false);
  });
});
