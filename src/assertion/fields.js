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

// One row per evaluator input, in `mauto assert` argv order:
//   scenario  the scenario field (or a function of the assertion naming it)
//   flag      the `mauto assert` flag, without `--` (also commander's option key)
//   input     the evaluator input key
//   coerce    how the evaluator wants the flag's string value, when not as-is
const EXPECTED = Object.freeze({ scenario: (a) => EXPECTED_FIELD[a.type], flag: 'expected', input: 'expected' });
const FIELDS = Object.freeze([
  Object.freeze({ scenario: 'element_description', flag: 'target', input: 'target' }),
  EXPECTED,
  Object.freeze({ scenario: 'operator', flag: 'operator', input: 'operator' }),
  Object.freeze({ scenario: 'expected_count', flag: 'count', input: 'count', coerce: Number }),
  Object.freeze({ scenario: 'pattern', flag: 'pattern', input: 'pattern' }),
  Object.freeze({ scenario: 'variable_name', flag: 'variable', input: 'variable_name' }),
]);

// A row's value in a scenario assertion, stringified as it would reach the
// verb on a command line; undefined when the assertion does not carry it.
function scenarioValue(row, assertion) {
  const key = typeof row.scenario === 'function' ? row.scenario(assertion) : row.scenario;
  return key && assertion[key] !== undefined ? String(assertion[key]) : undefined;
}

// Scenario assertion -> the option object commander would parse from its
// `mauto assert` flags. Only provided keys.
function cliOptionsOf(assertion) {
  const options = {};
  for (const row of FIELDS) {
    const value = scenarioValue(row, assertion);
    if (value !== undefined) options[row.flag] = value;
  }
  return options;
}

// Scenario assertion -> `mauto assert` argv (after the type). Every value is
// stringified: that is what reaches the verb on a command line.
function toCliFlags(assertion) {
  return Object.entries(cliOptionsOf(assertion)).flatMap(([flag, value]) => [`--${flag}`, value]);
}

// `mauto assert` parsed options -> evaluator input. Only provided keys.
function fromCliFlags(type, flags = {}) {
  const input = { type };
  for (const row of FIELDS) {
    const value = flags[row.flag];
    if (value !== undefined) input[row.input] = row.coerce ? row.coerce(value) : value;
  }
  return input;
}

// Scenario assertion -> evaluator input, defined as the CLI path composed
// (scenario -> parsed flags -> evaluator input) so the in-process path
// stringifies exactly as a command line would. `expected_visible: false`
// reaches the evaluator as the string 'false' either way.
function toEvaluatorInput(assertion) {
  return fromCliFlags(assertion.type, cliOptionsOf(assertion));
}

// The expected value a result records for this assertion (the `--expected`
// of `mauto result add-assertion`), stringified; null when its type has no
// expected field or the assertion does not carry one.
function expectedOf(assertion) {
  const value = scenarioValue(EXPECTED, assertion);
  return value === undefined ? null : value;
}

module.exports = { EXPECTED_FIELD, FIELDS, toEvaluatorInput, fromCliFlags, toCliFlags, expectedOf };
