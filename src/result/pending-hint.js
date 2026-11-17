'use strict';

// What an agent must do to complete a run that is waiting for its judgment
// (#275): the pending assertions, the `incomplete` message and hint, and the
// envelope built from them. Shared by `result finalize` and `mauto run`.

const path = require('path');

const { fail } = require('../output/envelope');
const { REFERENCE_SCREENSHOT_TYPES } = require('../assertion/evaluator');
const { isPendingAssertion, isPendingStep } = require('./outcome');

// The assertions a finalized result is still waiting on, as `{assertion_id,
// step_id, type}` — what `mauto run` puts in data.pending.
function pendingAssertions(result) {
  return (result.assertion_results || [])
    .filter(isPendingAssertion)
    .map(({ assertion_id, step_id = null, type = null }) => ({ assertion_id, step_id, type }));
}

// A pending assertion is one of two classes. A reference screenshot
// (REFERENCE_SCREENSHOT_TYPES, the evaluator's set) is pending because its
// baseline does not exist yet, and a missing baseline is never judged by eye
// (#327); every other pending type waits for an agent's verdict.
function pendingByClass(result) {
  const pending = (result.assertion_results || []).filter(isPendingAssertion);
  const isReference = (a) => REFERENCE_SCREENSHOT_TYPES.has(a.type);
  return { judged: pending.filter((a) => !isReference(a)), references: pending.filter(isReference) };
}

// The error message of an `incomplete` run, shared by `result finalize` and
// `mauto run`. Counts the pending assertions by class; a run pending only on
// a step names no count.
function incompleteMessage(result) {
  const { judged, references } = pendingByClass(result);
  const counts = [
    judged.length ? `${judged.length} assertion(s) need agent judgment` : null,
    references.length ? `${references.length}${judged.length ? '' : ' assertion(s)'} need a reference screenshot` : null,
  ].filter(Boolean);
  return `run ${result.run_id} incomplete${counts.length ? `: ${counts.join(', ')}` : ''}`;
}

// A flag value as it must be typed into a shell: bare when that is safe, else
// JSON-quoted.
const arg = (value) => (/^[\w./@:+-]+$/.test(String(value)) ? String(value) : JSON.stringify(String(value)));

// The hint lines for the assertions waiting on an agent's verdict: their ids,
// then the exact `result add-assertion` line each (only the verdict and the
// reason left to fill).
function judgedBlock(judged, { runId }) {
  if (!judged.length) return [];
  return [
    `Pending agent judgment: ${judged.map((a) => a.assertion_id).join(', ')}. Decide each, then re-finalize:`,
    ...judged.map(
      (a) =>
        `mauto result add-assertion --run-id ${runId} --step-id ${a.step_id == null ? '<step_id>' : arg(a.step_id)} ` +
        `--assertion-id ${arg(a.assertion_id)} --type ${a.type == null ? '<type>' : arg(a.type)} ` +
        '--pass <true|false> --judge agent --message "<why>"'
    ),
  ];
}

// The hint lines for the reference screenshots without a baseline: the
// capture of each to show the user, then the re-run that records the
// baselines. No `result add-assertion` line: each is already pending, so one
// could only replace the runner's entry in place and drop its screenshot
// paths (ResultStore#addAssertion).
function referenceBlock(references, { projectRoot, scenario }) {
  if (!references.length) return [];
  return [
    `Pending reference screenshot: ${references.map((a) => a.assertion_id).join(', ')}. Never judge it by eye: show the user each capture.`,
    ...references.map(
      (a) => `${a.assertion_id}: ${a.actual_screenshot ? path.resolve(projectRoot, a.actual_screenshot) : 'no capture recorded'}`
    ),
    'Once the user confirms the screen is correct, record the baselines under a new run id ' +
      '(this re-records every screenshot_match in the scenario):',
    `mauto run ${scenario} --update-references`,
    'Otherwise leave it pending; the run stays incomplete. Re-finalize once the run is decided:',
  ];
}

// The hint lines for the steps the runner left to the agent: what each needs,
// then the `result add-step` line that replaces its pending record
// (ResultStore#addStep, #329). The runner stopped at the first one, so the
// steps after it are the agent's too.
function stepBlock(steps, { runId }) {
  if (!steps.length) return [];
  return [
    ...steps.map((s) => `Pending step ${s.step_id}: ${s.error_message || 'needs an agent'}`),
    'The runner stopped there, so the steps after it did not run. Do what it asks, record it, then perform ' +
      'each later step (and its assertions) with one-shot verbs and record it the same way:',
    ...steps.map((s) => `mauto result add-step --run-id ${runId} --step-id ${arg(s.step_id)} --status <pass|fail>`),
  ];
}

// The hint for an `incomplete` run: the pending steps, a block per pending
// class, then the re-finalize. The scenario path is the one the executor
// recorded, so the re-run and the re-finalize use the same file, printed
// absolute (resolved against `projectRoot`): --scenario resolves against the
// cwd while the workspace is discovered by walking up from it, so a
// project-relative path would be wrong from any subdirectory.
function pendingHint(result, { projectRoot }) {
  const { judged, references } = pendingByClass(result);
  const pendingSteps = (result.steps_executed || []).filter(isPendingStep);
  const runId = arg(result.run_id);
  const recorded = result.executor && result.executor.scenario_path;
  const scenario = recorded ? arg(path.resolve(projectRoot, recorded)) : '<scenario.json>';
  const nothingPending = judged.length + references.length === 0;
  return [
    ...stepBlock(pendingSteps, { runId }),
    ...judgedBlock(judged, { runId }),
    ...referenceBlock(references, { projectRoot, scenario }),
    ...(nothingPending ? ['No assertion is pending; re-finalize once the run is decided:'] : []),
    `mauto result finalize --run-id ${runId} --scenario ${scenario}`,
  ].join('\n');
}

// The `incomplete` (exit 7) envelope, shared by `result finalize` and
// `mauto run`: the message, the store's hints, then the commands that complete
// the run. `data` is what the envelope carries.
function incompleteEnvelope(result, { hints, projectRoot, data }) {
  return fail('incomplete', incompleteMessage(result), [...hints, pendingHint(result, { projectRoot })].join('\n'), data);
}

module.exports = { arg, pendingAssertions, pendingHint, incompleteMessage, incompleteEnvelope };
