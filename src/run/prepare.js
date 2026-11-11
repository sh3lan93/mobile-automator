'use strict';

const { fail } = require('../output/envelope');
const { loadScenario } = require('../scenario/load');
const { isResultRunId } = require('../result/store');
const { resolveRunId } = require('../observe/settings');
const { replayEnabled } = require('./gate');
const { makeRunId } = require('./run-id');

// Everything `mauto run` decides before it touches a device, in order: the
// MAUTO_REPLAY gate, the scenario (strict: a blocking replayability finding
// refuses), then the run id — the --run-id flag, else MAUTO_RUN_ID, else
// minted from `now()` — which must name a result file. Returns
// `{ scenario, runId }` or `{ failure: { envelope, exitKind } }`.
function prepareRun({ validator, file, runId: flag, env = process.env, now = () => new Date() }) {
  if (!replayEnabled(env)) {
    return {
      failure: {
        envelope: fail(
          'environment',
          'mauto run is not enabled yet',
          'export MAUTO_REPLAY=1 to try the in-progress replay runner'
        ),
        exitKind: 'environment',
      },
    };
  }

  const loaded = loadScenario(validator, file, { strict: true });
  if (loaded.failure) return { failure: loaded.failure };

  const runId = flag || resolveRunId(env) || makeRunId(now());
  if (!isResultRunId(runId)) {
    return {
      failure: {
        envelope: fail(
          'invalid_input',
          `invalid run id "${runId}"`,
          'Pass --run-id run_YYYYMMDD_HHMMSS (or omit it to mint one); a run id names a result file and cannot contain a path separator.'
        ),
        exitKind: 'invalid_input',
      },
    };
  }

  return { scenario: loaded.scenario, runId };
}

module.exports = { prepareRun };
