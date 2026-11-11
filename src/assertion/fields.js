'use strict';

// The single scenario <-> evaluator <-> CLI mapping for assertions.
//
// A scenario assertion names its fields one way (`element_description`,
// `expected_value`, `expected_count`, ...), `mauto assert` takes flags
// (`--target`, `--expected`, `--count`, ...), and the pure evaluator in
// ./evaluator.js reads a third shape (`target`, `expected`, `count`, ...).
// Every path to a verdict goes through this module, so an agent driving
// `mauto assert` and `mauto run` evaluating in-process cannot build different
// evaluator inputs from the same scenario assertion.

// Which scenario field carries the expected value for each mechanical type,
// per the execute guide's assertion table. `--expected` is the one flag
// `mauto assert` reads it from.
const EXPECTED_FIELD = Object.freeze({
  element_text: 'expected_value',
  text_contains: 'expected_substring',
  element_hint: 'expected_text',
  content_description: 'label_value',
  has_accessibility_label: 'label_value',
  element_visible: 'expected_visible',
});

// Scenario assertion -> `mauto assert` argv (after the type). Every value is
// stringified: that is what reaches the verb on a command line.
function toCliFlags(assertion) {
  const flags = [];
  if (assertion.element_description !== undefined) flags.push('--target', String(assertion.element_description));
  const field = EXPECTED_FIELD[assertion.type];
  if (field && assertion[field] !== undefined) flags.push('--expected', String(assertion[field]));
  if (assertion.operator !== undefined) flags.push('--operator', String(assertion.operator));
  if (assertion.expected_count !== undefined) flags.push('--count', String(assertion.expected_count));
  if (assertion.pattern !== undefined) flags.push('--pattern', String(assertion.pattern));
  if (assertion.variable_name !== undefined) flags.push('--variable', String(assertion.variable_name));
  return flags;
}

// `mauto assert` parsed options -> evaluator input. Only provided keys.
function fromCliFlags(type, flags = {}) {
  const input = { type };
  if (flags.target !== undefined) input.target = flags.target;
  if (flags.expected !== undefined) input.expected = flags.expected;
  if (flags.operator !== undefined) input.operator = flags.operator;
  if (flags.count !== undefined) input.count = Number(flags.count);
  if (flags.pattern !== undefined) input.pattern = flags.pattern;
  if (flags.variable !== undefined) input.variable_name = flags.variable;
  return input;
}

// Scenario assertion -> evaluator input, defined as the CLI path composed
// (scenario -> flags -> evaluator input) so the in-process path stringifies
// exactly as a command line would. `expected_visible: false` reaches the
// evaluator as the string 'false' either way.
function toEvaluatorInput(assertion) {
  const flags = {};
  const argv = toCliFlags(assertion);
  for (let i = 0; i < argv.length; i += 2) flags[argv[i].slice(2)] = argv[i + 1];
  return fromCliFlags(assertion.type, flags);
}

module.exports = { EXPECTED_FIELD, toEvaluatorInput, fromCliFlags, toCliFlags };
