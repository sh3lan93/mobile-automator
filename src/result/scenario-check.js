'use strict';

// Whether what a run recorded belongs to the scenario it claims (#275).
// Shared by `result finalize --scenario`.

const { flattenSteps } = require('../scenario/steps');

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
  // `mauto run` records each precondition device_action as `precondition_<n>`
  // (1-based position in preconditions.device_actions).
  const setup = scenario.preconditions && scenario.preconditions.device_actions;
  if (Array.isArray(setup)) setup.forEach((_, i) => stepIds.add(`precondition_${i + 1}`));
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

// The reverse of crossCheck (#335): what the scenario declares that the run
// never recorded, as `{steps, assertions}` id lists in document order. A run
// that stopped after its last record would otherwise derive `passed` from
// what little it holds.
//
// Declared steps are `precondition_<n>` (one per device_action, as `mauto run`
// records them) then the whole step tree. A step counts as recorded when it,
// an ancestor or a descendant has a record: the runner records only top-level
// steps and carries their sub-steps in `sub_steps_executed`, while an agent
// may record sub-steps one by one. A sub-step whose parent has no record and
// that has none of its own stays unrecorded, even when a sibling has one.
// Preconditions have no tree, so only their own id covers them.
//
// No step is exempt for a reason: the runner records every step it reaches,
// a false condition or an optional miss as `skipped`, and evaluates the
// assertions after each; it stops early only on a failed step or one needing
// an agent, whose run is already decided `failed` or `incomplete`.
function unrecordedEntries(recorded, scenario) {
  const stepIds = new Set(recorded.steps.map((s) => s.step_id));
  const setup = scenario.preconditions && scenario.preconditions.device_actions;
  const preconditions = (Array.isArray(setup) ? setup : [])
    .map((_, i) => `precondition_${i + 1}`)
    .filter((id) => !stepIds.has(id));

  const tree = flattenSteps(scenario);
  const recordedPaths = tree.filter(({ step }) => stepIds.has(step.id)).map(({ path }) => path);
  const within = (inner, outer) => inner === outer || inner.startsWith(`${outer}.`);
  const covered = (path) => recordedPaths.some((p) => within(path, p) || within(p, path));
  const steps = tree.filter(({ path }) => !covered(path)).map(({ step }) => step.id);

  const assertionIds = new Set(recorded.assertions.map((a) => a.assertion_id));
  const assertions = (scenario.assertions || []).map((a) => a.id).filter((id) => !assertionIds.has(id));
  return { steps: [...preconditions, ...steps], assertions };
}

module.exports = { crossCheck, scenarioMismatch, unrecordedEntries };
