'use strict';

// Golden gate for the real-device E2E harness.
//
// A scenario declares itself a golden one with the `golden` TAG — a field the
// scenario schema defines and the scenario author sets — never a naming
// convention on its id. The tag is enforced in both directions, so the gate
// cannot silently lapse in either one:
//
//   tagged | fixture in golden/ | outcome
//   -------+--------------------+-----------------------------------------------
//   yes    | missing            | problem: the declared golden does not exist
//   yes    | present            | compared, but only for a run that passed
//   no     | present            | problem: a stray fixture nobody declared
//   no     | missing            | no golden check (none was declared)
//
// The diff only runs for a passing run: a run that stopped early differs from
// the golden by construction, and listing every unreached step would bury the
// failure that matters.

const fs = require('fs');
const path = require('path');

const { normalizeResult, diffNormalized } = require('./normalize-result');

/**
 * Golden problems for one finished run, as report lines; empty when there are
 * none.
 *
 * @param {object} run
 * @param {string} run.scenarioId   the scenario's own id
 * @param {string[]} [run.tags]     the scenario's `tags`; `golden` is the gate
 * @param {string} run.goldenDir     sample-app/scenarios/golden
 * @param {string} run.resultPath    the run's result file (`result finalize`'s)
 * @param {boolean} run.passed       whether the run passed every step and assertion
 * @param {Function} [run.log]       injected logger
 * @returns {string[]}
 */
function goldenProblems({ scenarioId, tags, goldenDir, resultPath, passed, log = () => {} }) {
  const goldenPath = path.join(goldenDir, `${scenarioId}.result.json`);
  const tagged = (Array.isArray(tags) ? tags : []).includes('golden');

  if (!tagged) {
    return fs.existsSync(goldenPath)
      ? [`golden fixture ${goldenPath} exists but scenario "${scenarioId}" is not tagged golden — add the tag or remove the fixture`]
      : [];
  }

  if (!fs.existsSync(goldenPath)) {
    const lines = [`golden fixture missing: ${goldenPath} (scenario "${scenarioId}" is tagged golden)`];
    if (fs.existsSync(resultPath)) {
      log(`no golden for ${scenarioId}. Normalized result of this run:`);
      console.log(JSON.stringify(normalizeResult(JSON.parse(fs.readFileSync(resultPath, 'utf8'))), null, 2));
      lines.push('once a PASSING run is the intended behaviour, save its normalized JSON (printed above) as that file');
    }
    return lines;
  }

  if (!passed) return [];
  const expected = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
  const actual = normalizeResult(JSON.parse(fs.readFileSync(resultPath, 'utf8')));
  return diffNormalized(expected, actual).map((line) => `golden mismatch: ${line}`);
}

module.exports = { goldenProblems };
