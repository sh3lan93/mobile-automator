'use strict';

// Pure assertion evaluator.
//
// The `mauto guide execute` reasoning floor splits the 27 assertion types into
// tiers:
//
//   Tier 1 — element-list-powered. These are purely MECHANICAL: a deterministic
//            check over the agnostic element list (+ captured variables / a
//            previous snapshot / the screen size). The CLI owns them.
//
//   Tier 2 — screenshot + AI visual analysis. These require an agent to judge a
//            screenshot, so the CLI cannot decide pass/fail. We surface them as
//            needs_agent with pass = null.
//
// (screenshot_match is a third class, REFERENCE_SCREENSHOT_TYPES below.)
//
// MECHANICAL_TYPES is the Tier-1 list from that guide section. It leaves out
// `element_state`, whose per-attribute state inspection is not represented in
// the agnostic element model (no enabled/focused/checked fields survive
// normalization), and `alert_present` / `alert_text`, for which the element
// list carries no platform-agnostic signal that a dialog is up. Three types
// were promoted from Tier 2 by #276, each decided over what the element list
// does carry, and each narrower than a screenshot judgment would be:
//   element_fully_visible   — the bounds lie inside the screen (not clipped by
//                             its edges; overlap by another element is NOT
//                             detected);
//   screen_title            — an element whose text/label equals the title
//                             starts in the top quarter of the screen;
//   permission_dialog_shown — a system allow button and a deny button are both
//                             on screen (+ the permission named, if given).

const { ALLOW_LABELS, DENY_LABELS, findByLabels } = require('../dialog/permission-labels');

const MECHANICAL_TYPES = new Set([
  'element_exists',
  'element_not_exists',
  'element_visible',
  'element_text',
  'text_contains',
  'text_not_empty',
  'element_hint',
  'pattern_match',
  'element_count',
  'list_item_count',
  'list_is_empty',
  'content_description',
  'has_accessibility_label',
  'value_matches_variable',
  'text_changed',
  'element_fully_visible',
  'screen_title',
  'permission_dialog_shown',
]);

// The mechanical types that need `ctx.screenSize` ({width, height}, in the
// element bounds' coordinate space). Callers fetch the screen size only for
// these, so every other assertion costs no extra device call.
const SCREEN_SIZE_TYPES = new Set(['element_fully_visible', 'screen_title']);

// A title sits in the top quarter of the screen.
const TITLE_BAND = 0.25;

// The types the CLI decides by comparing a stable screenshot against a stored
// reference image (src/run/reference-assertion.js, #281) rather than over the
// element list. Disjoint from MECHANICAL_TYPES: `evaluate()` below stays pure
// and keeps answering needs_agent for them — the comparison needs files and a
// device, so it lives in the runner and `mauto assert`, which branch on this
// set before they reach `evaluate()`.
const REFERENCE_SCREENSHOT_TYPES = new Set(['screenshot_match']);

// Both platforms' system-dialog button labels: the assertion is agnostic, so a
// dialog counts whichever platform drew it.
const ANY_ALLOW = [...new Set(Object.values(ALLOW_LABELS).flat())];
const ANY_DENY = [...new Set(Object.values(DENY_LABELS).flat())];

function labelOf(e) {
  return (e && typeof e.accessibility_label === 'string') ? e.accessibility_label : '';
}

// The element's displayed content for content assertions. A real text node
// wins; when an element carries none (common in agnostic UIs that expose
// content through Semantics/accessibility labels rather than text), fall back
// to the accessibility label so content assertions work on label-driven apps
// instead of always seeing an empty string.
function textOf(e) {
  if (e && typeof e.text === 'string' && e.text.length > 0) return e.text;
  return labelOf(e);
}

// An element "matches" a target string if the target appears (case-insensitive)
// in its text or its accessibility label. A null/empty target matches all.
function matches(e, target) {
  if (target === undefined || target === null || target === '') return true;
  const needle = String(target).toLowerCase();
  return (
    textOf(e).toLowerCase().includes(needle) ||
    labelOf(e).toLowerCase().includes(needle)
  );
}

function findFirst(elements, target) {
  return elements.find((e) => matches(e, target)) || null;
}

function countMatching(elements, target) {
  return elements.filter((e) => matches(e, target)).length;
}

function compare(actual, operator, expected) {
  switch (operator) {
    case '>':
      return actual > expected;
    case '>=':
      return actual >= expected;
    case '<':
      return actual < expected;
    case '<=':
      return actual <= expected;
    case '!=':
      return actual !== expected;
    case '==':
    case '=':
    case undefined:
    case null:
    default:
      return actual === expected;
  }
}

function boolFromFlag(v, dflt = true) {
  if (v === undefined || v === null || v === '') return dflt;
  if (typeof v === 'boolean') return v;
  return String(v).toLowerCase() !== 'false';
}

function result(type, mechanical, pass, message) {
  return {
    type,
    mechanical,
    pass,
    needs_agent: !mechanical,
    message,
  };
}

function needsAgent(type) {
  return result(
    type,
    false,
    null,
    `Assertion '${type}' is a Tier-2 visual check; the agent must judge it from a screenshot.`
  );
}

// A usable {width, height} or null.
function validScreenSize(s) {
  if (!s || typeof s !== 'object') return null;
  const width = Number(s.width);
  const height = Number(s.height);
  return width > 0 && height > 0 ? { width, height } : null;
}

const sizeOf = (s) => `${s.width}x${s.height}`;

// Evaluate a single assertion.
//   assertion: { type, target?, expected?, operator?, count?, pattern?, variable_name?, permission_name? }
//   ctx:       { elements, variables = {}, previous = null, screenSize = null }
function evaluate(assertion = {}, ctx = {}) {
  const type = assertion.type;
  const elements = Array.isArray(ctx.elements) ? ctx.elements : [];
  const variables = ctx.variables || {};
  const previous = Array.isArray(ctx.previous) ? ctx.previous : null;
  const screenSize = validScreenSize(ctx.screenSize);

  if (!MECHANICAL_TYPES.has(type)) {
    return needsAgent(type);
  }
  if (SCREEN_SIZE_TYPES.has(type) && !screenSize) {
    return result(type, true, false, `No screen size to check '${type}' against.`);
  }

  const target = assertion.target;
  let pass = false;
  let message = '';

  switch (type) {
    case 'element_exists': {
      const found = findFirst(elements, target);
      pass = Boolean(found);
      message = pass
        ? `Element matching '${target}' is present.`
        : `No element matching '${target}' found on screen.`;
      break;
    }
    case 'element_not_exists': {
      const found = findFirst(elements, target);
      pass = !found;
      message = pass
        ? `Element matching '${target}' is absent, as expected.`
        : `Element matching '${target}' is present but expected to be absent.`;
      break;
    }
    case 'element_visible': {
      const wantVisible = boolFromFlag(assertion.expected, true);
      const found = Boolean(findFirst(elements, target));
      pass = found === wantVisible;
      message = pass
        ? `Element '${target}' visibility=${found} matches expected=${wantVisible}.`
        : `Element '${target}' visibility=${found} but expected=${wantVisible}.`;
      break;
    }
    case 'element_text': {
      const found = findFirst(elements, target);
      const actual = found ? textOf(found) : null;
      pass = actual !== null && actual === assertion.expected;
      message = pass
        ? `Element '${target}' text equals '${assertion.expected}'.`
        : `Element '${target}' text is '${actual}', expected '${assertion.expected}'.`;
      break;
    }
    case 'text_contains': {
      const needle = String(assertion.expected == null ? '' : assertion.expected);
      const scope = assertion.target ? elements.filter((e) => matches(e, assertion.target)) : elements;
      const hit = scope.find((e) => textOf(e).includes(needle));
      pass = Boolean(hit);
      message = pass
        ? `Found text containing '${needle}'.`
        : `No element text contains '${needle}'.`;
      break;
    }
    case 'text_not_empty': {
      const found = findFirst(elements, target);
      pass = Boolean(found) && textOf(found).length > 0;
      message = pass
        ? `Element '${target}' has non-empty text.`
        : `Element '${target}' has empty or missing text.`;
      break;
    }
    case 'element_hint': {
      const found = findFirst(elements, target);
      // The agnostic model has no dedicated hint field; treat text/label as the
      // best available surface for a hint/placeholder match.
      const surface = found ? `${textOf(found)} ${labelOf(found)}` : '';
      const expected = String(assertion.expected == null ? '' : assertion.expected);
      pass = Boolean(found) && surface.includes(expected);
      message = pass
        ? `Element '${target}' hint matches '${expected}'.`
        : `Element '${target}' hint does not match '${expected}'.`;
      break;
    }
    case 'pattern_match': {
      let re;
      try {
        re = new RegExp(assertion.pattern);
      } catch (err) {
        return result(type, true, false, `Invalid regex pattern: ${err.message}`);
      }
      const scope = assertion.target ? elements.filter((e) => matches(e, assertion.target)) : elements;
      pass = scope.some((e) => re.test(textOf(e)));
      message = pass
        ? `At least one element text matches /${assertion.pattern}/.`
        : `No element text matches /${assertion.pattern}/.`;
      break;
    }
    case 'element_count':
    case 'list_item_count': {
      const actual = countMatching(elements, target);
      const expected = Number(assertion.count);
      const operator = assertion.operator || '==';
      pass = compare(actual, operator, expected);
      message = pass
        ? `Count ${actual} ${operator} ${expected} for '${target}'.`
        : `Count ${actual} does not satisfy ${operator} ${expected} for '${target}'.`;
      break;
    }
    case 'list_is_empty': {
      const actual = countMatching(elements, target);
      pass = actual === 0;
      message = pass
        ? `No items matching '${target}' (list empty).`
        : `${actual} item(s) matching '${target}' present (list not empty).`;
      break;
    }
    case 'content_description': {
      const found = findFirst(elements, target);
      const label = found ? labelOf(found) : '';
      const expected = String(assertion.expected == null ? '' : assertion.expected);
      pass = Boolean(found) && (expected === '' ? label.length > 0 : label === expected);
      message = pass
        ? `Element '${target}' content-description matches.`
        : `Element '${target}' content-description '${label}' did not match '${expected}'.`;
      break;
    }
    case 'has_accessibility_label': {
      const found = findFirst(elements, target);
      const label = found ? labelOf(found) : '';
      pass = Boolean(found) && label.length > 0;
      message = pass
        ? `Element '${target}' has a non-empty accessibility label.`
        : `Element '${target}' is missing an accessibility label.`;
      break;
    }
    case 'value_matches_variable': {
      const varName = assertion.variable_name;
      const expected = variables[varName];
      const found = findFirst(elements, target);
      const actual = found ? textOf(found) : null;
      pass = expected !== undefined && actual !== null && actual.includes(String(expected));
      message = pass
        ? `Element '${target}' contains variable '${varName}'=${expected}.`
        : `Element '${target}' text '${actual}' does not match variable '${varName}'=${expected}.`;
      break;
    }
    case 'text_changed': {
      if (!previous) {
        return result(type, true, false, `No previous snapshot to compare '${target}' against.`);
      }
      const curr = findFirst(elements, target);
      const prev = findFirst(previous, target);
      const currText = curr ? textOf(curr) : null;
      const prevText = prev ? textOf(prev) : null;
      pass = currText !== prevText;
      message = pass
        ? `Element '${target}' text changed from '${prevText}' to '${currText}'.`
        : `Element '${target}' text unchanged ('${currText}').`;
      break;
    }
    case 'element_fully_visible': {
      const found = findFirst(elements, target);
      if (!found) {
        return result(type, true, false, `No element matching '${target}' found on screen.`);
      }
      const [x1, y1, x2, y2] = found.bounds;
      const inside = [x1, y1, x2, y2].every(Number.isFinite) &&
        x1 >= 0 && y1 >= 0 && x2 <= screenSize.width && y2 <= screenSize.height;
      pass = inside;
      message = pass
        ? `Element '${target}' at [${found.bounds}] lies inside the ${sizeOf(screenSize)} screen.`
        : `Element '${target}' at [${found.bounds}] is clipped by the edges of the ${sizeOf(screenSize)} screen.`;
      break;
    }
    case 'screen_title': {
      const expected = String(assertion.expected == null ? '' : assertion.expected).trim().toLowerCase();
      const band = TITLE_BAND * screenSize.height;
      const carriers = elements.filter((e) =>
        [e.text, e.accessibility_label].some((v) => typeof v === 'string' && v.trim().toLowerCase() === expected));
      const title = carriers.find((e) => Array.isArray(e.bounds) && e.bounds[1] < band);
      pass = expected !== '' && Boolean(title);
      if (pass) {
        message = `Screen title '${assertion.expected}' found at top edge y=${title.bounds[1]} (title band y < ${band}).`;
      } else if (carriers.length) {
        const tops = carriers.map((e) => (Array.isArray(e.bounds) ? e.bounds[1] : '?')).join(', ');
        message = `'${assertion.expected}' is on screen but below the title band (top edge y=${tops}, band y < ${band}).`;
      } else {
        message = `No element carries the screen title '${assertion.expected}'.`;
      }
      break;
    }
    case 'permission_dialog_shown': {
      const allow = findByLabels(elements, ANY_ALLOW);
      const deny = findByLabels(elements, ANY_DENY);
      const name = assertion.permission_name;
      const named = name === undefined || name === null || name === ''
        ? true
        : elements.some((e) => matches(e, name));
      pass = Boolean(allow && deny) && named;
      if (pass) {
        message = `Permission dialog shown ('${allow.label}' / '${deny.label}')${name ? ` for '${name}'` : ''}.`;
      } else if (!allow || !deny) {
        const missing = [!allow && 'an allow button', !deny && 'a deny button'].filter(Boolean).join(' and ');
        message = `No permission dialog: ${missing} not found on screen.`;
      } else {
        message = `A permission dialog is shown, but no element names '${name}'.`;
      }
      break;
    }
    default:
      // Should be unreachable given the MECHANICAL_TYPES guard above.
      return needsAgent(type);
  }

  return result(type, true, pass, message);
}

// `matches`/`findFirst` are exported for `mauto run`'s target resolver
// (src/run/resolve.js), which resolves tap targets with THIS matcher so a run
// and `mauto assert` can never disagree about what a target string means
// (#94). The real-device E2E harness had its own copy of that resolver until
// replay R7 (#283); it now calls `mauto run`.
module.exports = { MECHANICAL_TYPES, REFERENCE_SCREENSHOT_TYPES, SCREEN_SIZE_TYPES, evaluate, matches, findFirst, textOf, compare };
