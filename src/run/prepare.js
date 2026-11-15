'use strict';

const fs = require('fs');
const path = require('path');

const { fail } = require('../output/envelope');
const { loadScenario } = require('../scenario/load');
const { isResultRunId } = require('../result/store');
const { resolveRunId } = require('../observe/settings');
const { replayEnabled } = require('./gate');
const { makeRunId } = require('./run-id');
const { parsePositiveInt } = require('../util/parse-positive-int');

// Why the --junit path cannot take the report, or null. Checked before the
// run, so a CI job learns of a typo'd report directory before the device
// work rather than after it (atomicWrite would otherwise create the directory).
function statOf(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function junitRefusal(junitPath) {
  const target = statOf(junitPath);
  if (target && target.isDirectory()) return `--junit names a directory: ${junitPath}`;
  const dir = path.dirname(junitPath);
  const parent = statOf(dir);
  if (!parent) return `--junit directory does not exist: ${dir}`;
  if (!parent.isDirectory()) return `--junit directory is not a directory: ${dir}`;
  return null;
}

// The values `mauto run --judge` accepts.
const JUDGES = Object.freeze(['none']);

// Everything `mauto run` decides before it touches a device, in order: the
// MAUTO_REPLAY gate, the scenario (strict: a blocking replayability finding
// refuses), then the run id — the --run-id flag, else MAUTO_RUN_ID, else
// minted from `now()` — which must name a result file. Returns
// `{ scenario, runId, file, sha256, timeoutMs, judge }` (`sha256` is loadScenario's hash of the
// file, for the run's executor; `timeoutMs` the validated --timeout-ms or null; `judge` the
// validated --judge; `junitPath` the --junit path resolved against `cwd`, or null) or
// `{ failure: { envelope, exitKind } }`.
function prepareRun({
  validator, file, runId: flag, timeoutMs: timeoutFlag, judge = 'none', junit,
  cwd = process.cwd(), env = process.env, now = () => new Date(),
}) {
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

  // --judge names who decides the assertions only an agent can judge. Only
  // `none` exists: the runner has no judge (R2, see src/run/assertions.js),
  // so such an assertion is left needs_agent and the run ends incomplete.
  // Refused before the scenario is read, as --timeout-ms is.
  if (!JUDGES.includes(judge)) {
    return {
      failure: {
        envelope: fail(
          'invalid_input',
          `unknown --judge "${judge}"`,
          `Accepted: ${JUDGES.join(', ')}. With none, an assertion only an agent can judge is left needs_agent for an agent to decide.`
        ),
        exitKind: 'invalid_input',
      },
    };
  }

  // The --timeout-ms flag, when given, must be a positive integer (a plain
  // decimal string, or a number): checked before the scenario is even read.
  let timeoutMs = null;
  if (timeoutFlag !== undefined && timeoutFlag !== null) {
    const parsed = parsePositiveInt(timeoutFlag);
    if (parsed === null) {
      return {
        failure: {
          envelope: fail(
            'invalid_input',
            `invalid --timeout-ms "${timeoutFlag}"`,
            'Pass --timeout-ms a positive integer number of milliseconds; it caps how long any one step waits.'
          ),
          exitKind: 'invalid_input',
        },
      };
    }
    timeoutMs = parsed;
  }

  let junitPath = null;
  if (junit !== undefined && junit !== null) {
    junitPath = path.resolve(cwd, String(junit));
    const refusal = junitRefusal(junitPath);
    if (refusal) {
      return {
        failure: {
          envelope: fail(
            'invalid_input',
            refusal,
            'Pass --junit a file path whose directory already exists; mauto run writes the report there after the run.'
          ),
          exitKind: 'invalid_input',
        },
      };
    }
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

  return { scenario: loaded.scenario, runId, file, sha256: loaded.sha256, timeoutMs, judge, junitPath };
}

module.exports = { prepareRun, JUDGES };
