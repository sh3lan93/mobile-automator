'use strict';

// Pure assertion evaluator.
//
// The `mauto guide execute` reasoning floor splits the 27 assertion types into
// two tiers:
//
//   Tier 1 — element-list-powered. These are purely MECHANICAL: a deterministic
//            check over the agnostic element list (+ captured variables / a
//            previous snapshot). The CLI owns them.
//
//   Tier 2 — screenshot + AI visual analysis. These require an agent to judge a
//            screenshot, so the CLI cannot decide pass/fail. We surface them as
//            needs_agent with pass = null.
//
// MECHANICAL_TYPES is the verbatim Tier-1 list from that guide section,
// minus `element_state` whose per-attribute state
// inspection is not represented in the agnostic element model (no enabled/
// focused/checked fields survive normalization), so it cannot be decided
// mechanically here and falls through to needs_agent.
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
]);

function textOf(e) {
  return (e && typeof e.text === 'string') ? e.text : '';
}

function labelOf(e) {
  return (e && typeof e.accessibility_label === 'string') ? e.accessibility_label : '';
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

// Evaluate a single assertion.
//   assertion: { type, target?, expected?, operator?, count?, pattern?, variable_name? }
//   ctx:       { elements, variables = {}, previous = null }
function evaluate(assertion = {}, ctx = {}) {
  const type = assertion.type;
  const elements = Array.isArray(ctx.elements) ? ctx.elements : [];
  const variables = ctx.variables || {};
  const previous = Array.isArray(ctx.previous) ? ctx.previous : null;

  if (!MECHANICAL_TYPES.has(type)) {
    return needsAgent(type);
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
    default:
      // Should be unreachable given the MECHANICAL_TYPES guard above.
      return needsAgent(type);
  }

  return result(type, true, pass, message);
}

module.exports = { MECHANICAL_TYPES, evaluate };
