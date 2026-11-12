'use strict';

// Target resolution for `mauto run` (src/run/resolve.js) and the real-device
// E2E harness (sample-app/scripts/lib/resolve.js). The two files are kept
// byte-identical by tests/lint/run-resolve-copy.test.js until replay R7
// deletes the harness copy; edit both or neither.
//
// A scenario target is an on-screen string ("More", "Sample Shop"), never an
// OS element id: that is a locked invariant of agnostic mode, and the old
// harness broke it. The string is resolved with the CLI's OWN matcher —
// `findFirst`/`matches` from src/assertion/evaluator.js, INJECTED by the
// caller (the harness passes the one from the same install as the `mauto`
// binary under test) — so a run, the harness and `mauto assert` cannot
// disagree about what a target means. There is deliberately no fallback
// matcher in this file.

// How many perceivable strings a miss lists. Enough to see what screen the
// device is on; not a full dump.
const MAX_SEEN = 20;

class TargetNotFoundError extends Error {
  // `described` is true when `target` is already a rendered description
  // (describeTarget) rather than the raw scenario string.
  constructor(target, seen, described = false) {
    const listed = seen.length ? seen.map((s) => JSON.stringify(s)).join(', ') : '<nothing perceivable>';
    super(`no element matches target ${described ? target : JSON.stringify(target)}; on screen: ${listed}`);
    this.name = 'TargetNotFoundError';
    this.target = target;
    this.seen = seen;
  }
}

// The distinct non-blank text / accessibility-label strings on screen, in
// list order, capped at MAX_SEEN.
// An invalid target_pattern: retrying cannot fix it, so it carries
// `fatal: true` (runStep stops its retry loop on that).
class FatalPatternError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FatalStepError';
    this.fatal = true;
  }
}

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

// How a miss names what it looked for: the target string, the pattern, or both.
function describeTarget(target, pattern) {
  const parts = [];
  if (typeof target === 'string' && target.trim() !== '') parts.push(JSON.stringify(target));
  if (typeof pattern === 'string' && pattern !== '') parts.push(`pattern /${pattern}/`);
  return parts.join(' ');
}

/**
 * @param {object[]} elements  the `data` of `mauto elements`
 * @param {string} target      on-screen string from the scenario (may be absent when a pattern is given)
 * @param {{findFirst: Function, matches: Function, textOf?: Function}} matcher  the CLI's evaluator
 * @param {{pattern?: string}} [options]  `pattern`: a regex the element's text must match, for a
 *   label that cannot be a static string; with a target, the target narrows first and the pattern filters
 * @returns {{element: object, center: number[], matches: object[]}}
 */
function resolveTarget(elements, target, { findFirst, matches, textOf }, { pattern } = {}) {
  const hasTarget = typeof target === 'string' && target.trim() !== '';
  const hasPattern = typeof pattern === 'string' && pattern !== '';
  // The CLI matcher treats an empty target as "matches everything", which is
  // right for an assertion scope and wrong for a tap.
  if (!hasTarget && !hasPattern) {
    throw new Error('step has no target to resolve');
  }
  const list = Array.isArray(elements) ? elements : [];
  let element;
  let candidates;
  if (hasPattern) {
    let re;
    try {
      re = new RegExp(pattern);
    } catch (err) {
      throw new FatalPatternError(`invalid target_pattern ${JSON.stringify(pattern)}: ${err.message}`);
    }
    const narrowed = hasTarget ? list.filter((e) => matches(e, target)) : list;
    candidates = narrowed.filter((e) => re.test(textOf(e)));
    element = candidates[0];
  } else {
    element = findFirst(list, target);
    candidates = list.filter((e) => matches(e, target));
  }
  if (!element) {
    throw hasPattern
      ? new TargetNotFoundError(describeTarget(target, pattern), perceivable(list), true)
      : new TargetNotFoundError(target, perceivable(list));
  }
  return {
    element,
    center: centerOf(element),
    // Every candidate, so a caller can warn when the first-match rule had a
    // choice to make (a header and a nav item sharing a label, say).
    matches: candidates,
  };
}

module.exports = { resolveTarget, describeTarget, TargetNotFoundError, FatalPatternError, MAX_SEEN };
