'use strict';

// A step's `condition`: whether the step runs at all. Four types; the ones a
// run can decide on its own are decided here, and the rest throw
// NeedsAgentError (the run ends `incomplete` with the message as the
// instruction) rather than guess. A condition that is false skips the step; it
// is not a failure.
//
// Everything the condition reads comes in through `env`, so the truth table is
// testable without a device:
//   platform()         -> 'android' | 'ios'
//   orientation()      -> 'portrait' | 'landscape'
//   elements()         -> the current agnostic element list
//   variables          -> the run's captured values
//   statuses           -> Map(step id -> recorded status) of the steps so far
//   evaluator          -> { findFirst, compare }
// Each probe is called only by the condition type that needs it.

const { FatalStepError } = require('./fatal');
const { NeedsAgentError } = require('./needs-agent');

// device_property names a run can read. Anything else (api_level, ...) is
// the agent's to decide.
const DEVICE_PROPERTIES = Object.freeze(['platform', 'orientation']);

function required(condition, field) {
  const value = condition[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new FatalStepError(`${condition.type} condition has no "${field}"`);
  }
  return value;
}

// What `value` means for a variable comparison: a number compares numerically
// (a captured "42" is 42), a boolean compares as text, anything else as given.
function comparable(actual, expected) {
  if (typeof expected === 'number') return [Number(actual), expected];
  if (typeof expected === 'boolean') return [String(actual).toLowerCase(), String(expected)];
  return [actual, expected];
}

async function evaluateCondition(condition, env) {
  const operator = condition.operator || '==';
  const { compare, findFirst } = env.evaluator;

  switch (condition.type) {
    case 'device_property': {
      const property = typeof condition.property === 'string' ? condition.property.toLowerCase() : '';
      if (!DEVICE_PROPERTIES.includes(property)) {
        throw new NeedsAgentError(
          `condition device_property "${condition.property}" cannot be evaluated by mauto run `
          + `(only ${DEVICE_PROPERTIES.join(' and ')} can): decide whether this step applies, then finish the run`
        );
      }
      const actual = String(await env[property]()).toLowerCase();
      return compare(actual, operator, String(condition.value).toLowerCase());
    }
    case 'previous_step_skipped':
      return env.statuses.get(required(condition, 'step_id')) === 'skipped';
    case 'variable_value': {
      const name = required(condition, 'variable_name');
      if (!Object.prototype.hasOwnProperty.call(env.variables, name)) {
        throw new FatalStepError(`variable_value condition reads variable "${name}", which no earlier step captured`);
      }
      const [actual, expected] = comparable(env.variables[name], condition.value);
      return compare(actual, operator, expected);
    }
    case 'element_visible': {
      const target = required(condition, 'element_description');
      const visible = findFirst(await env.elements(), target) !== null;
      // `value` is whether the element is expected visible (default true).
      const expected = condition.value === undefined ? true : String(condition.value).toLowerCase() !== 'false';
      return compare(visible, operator, expected);
    }
    default:
      throw new FatalStepError(`unknown condition type "${condition.type}"`);
  }
}

module.exports = { evaluateCondition, DEVICE_PROPERTIES };
