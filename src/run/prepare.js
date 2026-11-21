'use strict';

const fs = require('fs');
const path = require('path');

const { fail } = require('../output/envelope');
const { loadScenario } = require('../scenario/load');
const { isResultRunId } = require('../result/store');
const { resolveRunId } = require('../observe/settings');
const { makeRunId } = require('./run-id');
const { parsePositiveInt } = require('../util/parse-positive-int');

// Why the --junit path cannot take the report, or null. Checked before the
// run, so a CI job learns of a typo'd report directory before the device
// work rather than after it (the report writer would otherwise create the
// directory).
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

// The values `mauto run --judge` accepts. Private: src/result/flags.js
// exports a different JUDGES, the ones `result add-assertion` takes.
const RUN_JUDGES = Object.freeze(['none']);

// A refusal: the envelope and the exit kind it maps to.
const refuse = (kind, message, hint) => ({ failure: { envelope: fail(kind, message, hint), exitKind: kind } });

// Everything `mauto run` decides before it touches a device, in this order:
// --judge, --timeout-ms, --junit, the scenario
// (strict: a blocking replayability finding refuses), then the run id (the
// --run-id flag, else MAUTO_RUN_ID, else minted from `now()`), which must
// name a result file. Returns `{ scenario, runId, file, sha256, timeoutMs,
// junitPath }` — `sha256` is loadScenario's hash of the file, for the run's
// executor; `timeoutMs` and `junitPath` (resolved against `cwd`) are null
// when not given — or `{ failure: { envelope, exitKind } }`.
function prepareRun({
  validator, file, runId: flag, timeoutMs: timeoutFlag, judge = 'none', junit,
  cwd = process.cwd(), env = process.env, now = () => new Date(),
}) {
  // --judge names who decides the assertions only an agent can judge. Only
  // `none` exists: the runner has no judge (R2, see src/run/assertions.js),
  // so such an assertion is left needs_agent and the run ends incomplete.
  // Validated, not returned: there is nothing yet for it to select.
  if (!RUN_JUDGES.includes(judge)) {
    return refuse(
      'invalid_input',
      `unknown --judge "${judge}"`,
      `Accepted: ${RUN_JUDGES.join(', ')}. With none, an assertion only an agent can judge is left needs_agent for an agent to decide.`
    );
  }

  // The --timeout-ms flag, when given, must be a positive integer (a plain
  // decimal string, or a number).
  let timeoutMs = null;
  if (timeoutFlag !== undefined && timeoutFlag !== null) {
    timeoutMs = parsePositiveInt(timeoutFlag);
    if (timeoutMs === null) {
      return refuse(
        'invalid_input',
        `invalid --timeout-ms "${timeoutFlag}"`,
        'Pass --timeout-ms a positive integer number of milliseconds; it caps how long any one step waits.'
      );
    }
  }

  let junitPath = null;
  if (junit !== undefined && junit !== null) {
    junitPath = path.resolve(cwd, String(junit));
    const refusal = junitRefusal(junitPath);
    if (refusal) {
      return refuse(
        'invalid_input',
        refusal,
        'Pass --junit a file path whose directory already exists; mauto run writes the report there after the run.'
      );
    }
  }

  const loaded = loadScenario(validator, file, { strict: true });
  if (loaded.failure) return { failure: loaded.failure };

  const runId = flag || resolveRunId(env) || makeRunId(now());
  if (!isResultRunId(runId)) {
    return refuse(
      'invalid_input',
      `invalid run id "${runId}"`,
      'Pass --run-id run_YYYYMMDD_HHMMSS (or omit it to mint one); a run id names a result file and cannot contain a path separator.'
    );
  }

  return { scenario: loaded.scenario, runId, file, sha256: loaded.sha256, timeoutMs, junitPath };
}

module.exports = { prepareRun };
