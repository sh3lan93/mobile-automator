'use strict';

const fs = require('fs');

const { fail } = require('../output/envelope');
const { findReplayWarnings, summarize } = require('./replayability');

// Read, parse, schema-validate and replay-check a scenario file. Returns
// `{ scenario, warnings, hint }` (hint null when there are no warnings) or
// `{ failure: { envelope, exitKind } }`. Shared by `validate` (which wraps it
// in an envelope) and `mauto run` (which refuses before any device work).
// `strict` fails on blocking replayability findings instead of warning.
function loadScenario(validator, file, opts = {}) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return {
      failure: {
        envelope: fail(
          'invalid_input',
          `cannot read file: ${err.message}`,
          'Check that the path exists and is readable.'
        ),
        exitKind: 'invalid_input',
      },
    };
  }

  let scenario;
  try {
    scenario = JSON.parse(raw);
  } catch (err) {
    return {
      failure: {
        envelope: fail(
          'invalid_input',
          `file is not valid JSON: ${err.message}`,
          'Fix the JSON syntax and try again.'
        ),
        exitKind: 'invalid_input',
      },
    };
  }

  const result = validator.validate(scenario);
  if (!result.valid) {
    const env = fail(
      'invalid_input',
      'scenario failed schema validation',
      'See data.errors for the specific schema violations.'
    );
    env.data = { valid: false, errors: result.errors };
    return { failure: { envelope: env, exitKind: 'invalid_input' } };
  }

  // Schema-valid is not the same as replayable: surface findings by default
  // so existing scenarios keep validating; `--strict` fails only on the
  // blocking ones. Codes, severity and wording live in the replayability module.
  const warnings = findReplayWarnings(scenario);
  if (warnings.length === 0) return { scenario, warnings, hint: null };
  const { blocking, hint } = summarize(warnings);
  if (opts.strict && blocking.length > 0) {
    const env = fail('invalid_input', 'scenario cannot replay unattended; see data.warnings', hint);
    env.data = { valid: false, errors: [], warnings };
    return { failure: { envelope: env, exitKind: 'invalid_input' } };
  }
  return { scenario, warnings, hint };
}

module.exports = { loadScenario };
