'use strict';

const crypto = require('crypto');

const { fail } = require('../output/envelope');
const { typedFail } = require('../output/typed-fail');
const { isTypedRefusal } = require('../output/typed-refusal');
const { readUserFile } = require('../workspace/safe-fs');
const { findReplayWarnings, summarize } = require('./replayability');

const cannotRead = (message) => ({
  failure: {
    envelope: fail('invalid_input', `cannot read file: ${message}`, 'Check that the path exists and is readable.'),
    exitKind: 'invalid_input',
  },
});

// Read, parse, schema-validate and replay-check a scenario file. Returns
// `{ scenario, sha256, warnings, hint }` (hint null when there are no
// warnings) or `{ failure: { envelope, exitKind } }`. Shared by `validate`
// (which wraps it in an envelope), `mauto run` (which refuses before any
// device work) and `result finalize --scenario`. `sha256` is the hex SHA-256
// of the bytes read — the one place a scenario is hashed, so the runner and
// finalize can never disagree on what "the same scenario" means (#275).
// `strict` fails on blocking replayability findings instead of warning.
//
// `projectRoot` (required) bounds the read (#363): the file is read through
// safe-fs's readUserFile, so a scenario inside the checkout reached through a
// committed link (a linked leaf, `flows -> /outside`) is refused environment,
// the message naming the path and never what it points at, while a file
// outside the project is the user's own and is read as named. An explicit
// null means there is no checkout (validate without a workspace): every file
// is then outside it. Leaving it out is a bug, and throws.
function loadScenario(validator, file, opts = {}) {
  const { projectRoot } = opts;
  if (projectRoot !== null && (typeof projectRoot !== 'string' || projectRoot === '')) {
    throw new TypeError('loadScenario: projectRoot is required (a path, or null for no checkout)');
  }
  let raw;
  let sha256;
  try {
    const bytes = readUserFile(projectRoot, file, { encoding: null, throwIfAbsent: true });
    sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    raw = bytes.toString('utf8');
  } catch (err) {
    if (isTypedRefusal(err)) return { failure: typedFail(err) };
    return cannotRead(err.message);
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
  if (warnings.length === 0) return { scenario, sha256, warnings, hint: null };
  const { blocking, hint } = summarize(warnings);
  if (opts.strict && blocking.length > 0) {
    const env = fail('invalid_input', 'scenario cannot replay unattended; see data.warnings', hint);
    env.data = { valid: false, errors: [], warnings };
    return { failure: { envelope: env, exitKind: 'invalid_input' } };
  }
  return { scenario, sha256, warnings, hint };
}

module.exports = { loadScenario };
