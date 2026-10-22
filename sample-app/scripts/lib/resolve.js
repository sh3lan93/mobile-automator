'use strict';

// Target resolution for the real-device E2E harness.
//
// A scenario target is an on-screen string ("More", "Sample Shop"), never an
// OS element id: that is a locked invariant of agnostic mode, and the old
// harness broke it. The string is resolved with the CLI's OWN matcher —
// `findFirst`/`matches` from src/assertion/evaluator.js, INJECTED by the
// caller from the same install as the `mauto` binary under test — so the
// harness and `mauto assert` cannot disagree about what a target means. There
// is deliberately no fallback matcher in this file.

// How many perceivable strings a miss lists. Enough to see what screen the
// device is on; not a full dump.
const MAX_SEEN = 20;

class TargetNotFoundError extends Error {
  constructor(target, seen) {
    const listed = seen.length ? seen.map((s) => JSON.stringify(s)).join(', ') : '<nothing perceivable>';
    super(`no element matches target ${JSON.stringify(target)}; on screen: ${listed}`);
    this.name = 'TargetNotFoundError';
    this.target = target;
    this.seen = seen;
  }
}

// The distinct non-blank text / accessibility-label strings on screen, in
// list order, capped at MAX_SEEN.
function perceivable(elements) {
  const seen = [];
  for (const e of elements) {
    for (const s of [e && e.text, e && e.accessibility_label]) {
      if (typeof s !== 'string' || s.trim() === '' || seen.includes(s)) continue;
      seen.push(s);
      if (seen.length === MAX_SEEN) return seen;
    }
  }
  return seen;
}

function centerOf(element) {
  if (Array.isArray(element.center)) return element.center;
  const [x1, y1, x2, y2] = element.bounds;
  return [Math.round((x1 + x2) / 2), Math.round((y1 + y2) / 2)];
}

/**
 * @param {object[]} elements  the `data` of `mauto elements`
 * @param {string} target      on-screen string from the scenario
 * @param {{findFirst: Function, matches: Function}} matcher  the CLI's evaluator
 * @returns {{element: object, center: number[], matches: object[]}}
 */
function resolveTarget(elements, target, { findFirst, matches }) {
  // The CLI matcher treats an empty target as "matches everything", which is
  // right for an assertion scope and wrong for a tap.
  if (typeof target !== 'string' || target.trim() === '') {
    throw new Error('step has no target to resolve');
  }
  const list = Array.isArray(elements) ? elements : [];
  const element = findFirst(list, target);
  if (!element) throw new TargetNotFoundError(target, perceivable(list));
  return {
    element,
    center: centerOf(element),
    // Every candidate, so a caller can warn when the first-match rule had a
    // choice to make (a header and a nav item sharing a label, say).
    matches: list.filter((e) => matches(e, target)),
  };
}

module.exports = { resolveTarget, TargetNotFoundError, MAX_SEEN };
