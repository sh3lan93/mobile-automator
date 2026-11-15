'use strict';

// `${name}` substitution: how a scenario's step `value` / `target` and its
// assertions' string fields read a variable captured earlier in the run
// (capture_value). The syntax is `${name}` with a declared variable's name
// (`^[a-z][a-z0-9_]*$`); it is deliberately not `{{name}}`, which the guide
// placeholder guard owns. There is no escape: a literal `${name}` in a field
// cannot be expressed, and a name that has no value is an error rather than
// being left in the text, so a scenario can never pass by typing a template.

const REFERENCE = /\$\{([a-z][a-z0-9_]*)\}/g;

// A reference to a variable nothing has captured. Fatal: retrying cannot
// capture it, so the step fails at once.
class UndefinedVariableError extends Error {
  constructor(name) {
    super(`variable "${name}" has no value: capture it with a capture_value step before using \${${name}}`);
    this.name = 'UndefinedVariableError';
    this.fatal = true;
    this.variable = name;
  }
}

function substitute(text, variables = {}) {
  return text.replace(REFERENCE, (_match, name) => {
    if (!Object.prototype.hasOwnProperty.call(variables, name) || variables[name] === undefined || variables[name] === null) {
      throw new UndefinedVariableError(name);
    }
    return String(variables[name]);
  });
}

// A copy of `object` with every string-valued own property outside `skip`
// substituted. Non-strings (numbers, booleans, nested objects) pass through.
function substituteFields(object, variables, skip = []) {
  const out = { ...object };
  for (const [key, value] of Object.entries(out)) {
    if (typeof value === 'string' && !skip.includes(key)) out[key] = substitute(value, variables);
  }
  return out;
}

// A step's fields that read variables: what it types and what it targets.
function substituteStep(step, variables) {
  const out = { ...step };
  for (const key of ['value', 'target']) {
    if (typeof out[key] === 'string') out[key] = substitute(out[key], variables);
  }
  return out;
}

// An assertion's string fields, except the ones that name rather than say.
const ASSERTION_NAMING_FIELDS = Object.freeze(['id', 'type', 'after_step', 'description', 'variable_name']);
const substituteAssertion = (assertion, variables) => substituteFields(assertion, variables, ASSERTION_NAMING_FIELDS);

module.exports = { substitute, substituteStep, substituteAssertion, UndefinedVariableError };
