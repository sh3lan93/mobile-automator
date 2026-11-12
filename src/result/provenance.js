'use strict';

// Result provenance (#275): who produced a result and from what, whether what
// it recorded belongs to the scenario it claims, and what an agent must do to
// complete a run that is waiting for its judgment. Pure apart from reading the
// workspace config (for `engine` and `mode`) and package.json; shared by
// `result finalize` and `mauto run`.

const path = require('path');

const { version: MAUTO_VERSION } = require('../../package.json');
const manager = require('../config/manager');
const { readEngine } = require('../device/engine');
const { fail } = require('../output/envelope');
const { isPendingAssertion } = require('./outcome');
const { flattenSteps } = require('../scenario/steps');
const resultSchema = require('../schemas/result_schema.json');

// The schema's executor.kind enum, read rather than restated.
const EXECUTOR_KINDS = resultSchema.properties.executor.properties.kind.enum;

const unique = (values) => [...new Set(values)];

// Every id the recorded run names that the scenario does not, as readable
// problem strings; empty when the result is consistent with the scenario. A
// recorded scenario_id of null (a run recorded without --scenario-id) is not
// compared. Steps are matched against the whole step tree, sub_steps included.
function crossCheck(recorded, scenario) {
  const problems = [];
  if (recorded.scenario_id != null && recorded.scenario_id !== scenario.scenario_id) {
    problems.push(`the run recorded scenario_id "${recorded.scenario_id}" but the scenario is "${scenario.scenario_id}"`);
  }
  const stepIds = new Set(flattenSteps(scenario).map(({ step }) => step.id));
  for (const id of unique(recorded.steps.map((s) => s.step_id))) {
    if (!stepIds.has(id)) problems.push(`step "${id}" is not in the scenario`);
  }
  const assertionIds = new Set((scenario.assertions || []).map((a) => a.id));
  for (const id of unique(recorded.assertions.map((a) => a.assertion_id))) {
    if (!assertionIds.has(id)) problems.push(`assertion "${id}" is not in the scenario`);
  }
  return problems;
}

// Why a recorded run cannot be finalized against a loaded scenario
// (`{scenario, sha256}`, from loadScenario), as `{message, hint, data}`, or
// null when it can. A scenario whose hash differs from the one the run
// recorded was edited since: refused first, since checking ids against a
// different file proves nothing. Then every recorded id must be the
// scenario's (crossCheck).
function scenarioMismatch(recorded, { scenario, sha256 }) {
  const recordedSha = recorded.executor && recorded.executor.scenario_sha256;
  if (recordedSha && recordedSha !== sha256) {
    return {
      message: 'the scenario changed since the run',
      hint: `The run was recorded against ${recorded.executor.scenario_path} (sha256 ${recordedSha}); finalize with that file, or re-run the scenario.`,
      data: { recorded_sha256: recordedSha, scenario_sha256: sha256 },
    };
  }
  const problems = crossCheck(recorded, scenario);
  if (problems.length === 0) return null;
  return {
    message: `the run does not match the scenario: ${problems.length} problem(s)`,
    hint: 'See data.problems. Pass the scenario this run executed, or fix the recorded ids; nothing was written.',
    data: { problems },
  };
}

// What executor.scenario_path means, the one place it is decided: relative
// to the project root when the file is inside it (so the result stays
// meaningful on another checkout), else absolute. `absolute` must already be
// resolved — against the caller's cwd — since a relative path here could mean
// either directory.
function recordedScenarioPath(projectRoot, absolute) {
  if (!path.isAbsolute(absolute)) {
    throw new Error(`scenario path must be absolute, got "${absolute}" (resolve it against the cwd first)`);
  }
  const relative = path.relative(projectRoot, absolute);
  return relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
    ? relative
    : absolute;
}

// The `executor` block a finalize records. `engine` resolves as the device
// layer resolves it (an exported MOBILEMCP_LEGACY_ROBOT wins over config), and
// `mode` as the guides resolve it (unset is platform-aware). The device fields
// are whatever the caller connected to — null when it connected to none.
// `scenarioPath` is absolute (or null); it is recorded per
// recordedScenarioPath, so `mauto run` and `result finalize --scenario` record
// the same value for the same file.
function buildExecutor({
  kind, projectRoot, platform = null, deviceId = null, scenarioPath = null, scenarioSha256 = null, env = process.env,
}) {
  if (!EXECUTOR_KINDS.includes(kind)) {
    throw new Error(`unknown executor kind "${kind}" (expected ${EXECUTOR_KINDS.join(' | ')})`);
  }
  const recordedPath = scenarioPath == null ? null : recordedScenarioPath(projectRoot, scenarioPath);
  return {
    kind,
    mauto_version: MAUTO_VERSION,
    engine: readEngine(projectRoot, { env }).engine,
    platform,
    device_id: deviceId,
    scenario_path: recordedPath,
    scenario_sha256: scenarioSha256,
    mode: manager.resolveMode(manager.load(projectRoot)),
  };
}

// The assertions a finalized result is still waiting on, as `{assertion_id,
// step_id, type}` — what `mauto run` puts in data.pending.
function pendingAssertions(result) {
  return (result.assertion_results || [])
    .filter(isPendingAssertion)
    .map(({ assertion_id, step_id = null, type = null }) => ({ assertion_id, step_id, type }));
}

// The error message of an `incomplete` run, shared by `result finalize` and
// `mauto run`. Counts the pending assertions; a run pending only on a step
// names no count.
function incompleteMessage(result) {
  const pending = pendingAssertions(result).length;
  return `run ${result.run_id} incomplete${pending ? `: ${pending} assertion(s) need agent judgment` : ''}`;
}

// A flag value as it must be typed into a shell: bare when that is safe, else
// JSON-quoted.
const arg = (value) => (/^[\w./@:+-]+$/.test(String(value)) ? String(value) : JSON.stringify(String(value)));

// The hint for an `incomplete` run: the pending ids, the exact
// `result add-assertion` line per pending assertion (only the verdict and the
// reason left to fill), then the re-finalize. The scenario path is the one
// the executor recorded, so the re-finalize is checked against the same file,
// printed absolute (resolved against `projectRoot`): --scenario resolves
// against the cwd while the workspace is discovered by walking up from it, so
// a project-relative path would be wrong from any subdirectory.
function pendingHint(result, { projectRoot }) {
  const pending = pendingAssertions(result);
  const runId = arg(result.run_id);
  const recorded = result.executor && result.executor.scenario_path;
  const scenarioPath = recorded ? path.resolve(projectRoot, recorded) : null;
  return [
    pending.length
      ? `Pending agent judgment: ${pending.map((p) => p.assertion_id).join(', ')}. Decide each, then re-finalize:`
      : 'No assertion is pending; re-finalize once the run is decided:',
    ...pending.map(
      (p) =>
        `mauto result add-assertion --run-id ${runId} --step-id ${p.step_id == null ? '<step_id>' : arg(p.step_id)} ` +
        `--assertion-id ${arg(p.assertion_id)} --type ${p.type == null ? '<type>' : arg(p.type)} ` +
        '--pass <true|false> --judge agent --message "<why>"'
    ),
    `mauto result finalize --run-id ${runId} --scenario ${scenarioPath ? arg(scenarioPath) : '<scenario.json>'}`,
  ].join('\n');
}

// The `incomplete` (exit 7) envelope, shared by `result finalize` and
// `mauto run`: the message, the store's hints, then the commands that complete
// the run. `data` is what the envelope carries.
function incompleteEnvelope(result, { hints, projectRoot, data }) {
  return fail('incomplete', incompleteMessage(result), [...hints, pendingHint(result, { projectRoot })].join('\n'), data);
}

module.exports = { incompleteEnvelope, crossCheck, scenarioMismatch, buildExecutor, pendingAssertions, pendingHint, incompleteMessage };
