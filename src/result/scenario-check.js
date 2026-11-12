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

module.exports = { crossCheck, scenarioMismatch };
