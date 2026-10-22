'use strict';

// The resolver is tested with the REAL evaluator injected: the point of the
// harness is that it resolves targets exactly as `mauto assert` does.
const evaluator = require('../../../src/assertion/evaluator');
const { resolveTarget, TargetNotFoundError } = require('../../../sample-app/scripts/lib/resolve');
const { homeElements, moreElements, moreLegacyElements, el } = require('./fixtures');

describe('resolveTarget', () => {
  test('resolves a bottom-nav label on the real Home screen to its center', () => {
    const r = resolveTarget(homeElements(), 'More', evaluator);
    expect(r.element.accessibility_label).toMatch(/^More\nTab 3 of 3/);
    expect(r.center).toEqual(r.element.center);
  });

  test('is case-insensitive', () => {
    const r = resolveTarget([el('Sample Shop')], 'sample shop', evaluator);
    expect(r.element.text).toBe('Sample Shop');
  });

  test('falls back to the accessibility label when text is absent', () => {
    const r = resolveTarget([el(null, { accessibility_label: 'Categories\nTab 2 of 3', center: [9, 9] })], 'categories', evaluator);
    expect(r.center).toEqual([9, 9]);
  });

  test('reports every match, first match wins (header before nav item)', () => {
    const header = el('More', { center: [1, 1] });
    const nav = el(null, { accessibility_label: 'More\nTab 3 of 3', center: [2, 2] });
    const r = resolveTarget([header, nav], 'More', evaluator);
    expect(r.element).toBe(header);
    expect(r.matches).toEqual([header, nav]);
  });

  test('a miss throws TargetNotFoundError listing what was perceivable', () => {
    const err = (() => {
      try {
        resolveTarget([el('Sample Shop'), el(null, { accessibility_label: 'Home\nTab 1 of 3' })], 'Checkout', evaluator);
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(TargetNotFoundError);
    expect(err.target).toBe('Checkout');
    expect(err.seen).toEqual(['Sample Shop', 'Home\nTab 1 of 3']);
    expect(err.message).toContain('Checkout');
    expect(err.message).toContain('Sample Shop');
  });

  test('caps the listed strings at 20 and de-duplicates them', () => {
    const many = Array.from({ length: 30 }, (_, i) => el(`item ${i}`)).concat([el('item 0')]);
    const err = (() => {
      try { resolveTarget(many, 'nope', evaluator); } catch (e) { return e; }
      return null;
    })();
    expect(err.seen).toHaveLength(20);
    expect(new Set(err.seen).size).toBe(20);
  });

  test('#251: "Search products" is not findable on the default engine, but is on the legacy robot', () => {
    expect(() => resolveTarget(moreElements(), 'Search products', evaluator)).toThrow(TargetNotFoundError);
    expect(resolveTarget(moreLegacyElements(), 'Search products', evaluator).element).toBeTruthy();
  });

  test('an empty target is rejected instead of matching everything', () => {
    expect(() => resolveTarget([el('a')], '', evaluator)).toThrow(/target/);
  });

  test('uses the injected matcher, not a private copy', () => {
    const calls = [];
    const fake = {
      findFirst: (els, t) => { calls.push(['findFirst', t]); return els[1]; },
      matches: (e, t) => { calls.push(['matches', t]); return e === undefined ? false : e.text === 'b'; },
    };
    const r = resolveTarget([el('a'), el('b')], 'anything', fake);
    expect(r.element.text).toBe('b');
    expect(calls[0]).toEqual(['findFirst', 'anything']);
  });
});
