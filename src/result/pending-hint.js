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

// What `result finalize --scenario` found the scenario declares and the run
// never recorded (#335): `{steps, assertions}` id lists, or none. `mauto run`
// passes none, and its output is unchanged.
const NO_GAPS = Object.freeze({ steps: [], assertions: [] });
const gapsOf = (unrecorded) => unrecorded || NO_GAPS;
const hasGaps = (unrecorded) => gapsOf(unrecorded).steps.length + gapsOf(unrecorded).assertions.length > 0;

// The message part counting the unrecorded entries, or null.
function gapCount(unrecorded) {
  const { steps, assertions } = gapsOf(unrecorded);
  if (!hasGaps(unrecorded)) return null;
  const parts = [
    steps.length ? `${steps.length} declared step(s)` : null,
    assertions.length ? `${assertions.length}${steps.length ? '' : ' declared'} assertion(s)` : null,
  ].filter(Boolean);
  return `${parts.join(' and ')} never recorded`;
}

// The error message of an `incomplete` run, shared by `result finalize` and
// `mauto run`. Counts the pending assertions by class, then the declared
// entries never recorded; a run pending only on a step names no count.
function incompleteMessage(result, { unrecorded } = {}) {
  const { judged, references } = pendingByClass(result);
  const counts = [
    judged.length ? `${judged.length} assertion(s) need agent judgment` : null,
    references.length ? `${references.length}${judged.length ? '' : ' assertion(s)'} need a reference screenshot` : null,
    gapCount(unrecorded),
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

// For a parent left pending by one of its sub-steps (src/run/tree.js: the
// pending sub-step is the last entry of sub_steps_executed), the line saying
// which sub-step stopped it, which already ran, and that the parent is what
// gets recorded: a record for the sub-step's id would append, and the parent
// would stay pending.
function subStepLine(step) {
  const subs = Array.isArray(step.sub_steps_executed) ? step.sub_steps_executed : [];
  if (!subs.length) return [];
  const stopped = subs[subs.length - 1].step_id;
  const ran = subs.slice(0, -1).map((s) => s.step_id);
  return [
    `Step ${step.step_id} stopped at its sub-step ${stopped}; mauto run already ran ${ran.length ? ran.join(', ') : 'none of the others'}. ` +
      `Do ${stopped} and every later sub-step of ${step.step_id}, then record ${step.step_id} once (not its sub-steps):`,
  ];
}

// The hint lines for the steps the runner left to the agent (#329): what each
// needs, then the `result add-step` line that replaces its pending record
// (ResultStore#addStep). `skipped` is offered because the runner also leaves
// a step pending when it cannot evaluate its condition, and a step whose
// condition does not hold is skipped, its assertions still checked.
function stepBlock(steps, { runId }) {
  if (!steps.length) return [];
  return [
    ...steps.flatMap((s) => [
      `Pending step ${s.step_id}: ${s.error_message || 'needs an agent'}`,
      ...subStepLine(s),
      `mauto result add-step --run-id ${runId} --step-id ${arg(s.step_id)} --status <pass|fail|skipped>`,
    ]),
    'mauto run stops at a pending step, so no step after it ran: perform each later step and its assertions with ' +
      'one-shot verbs, recording each the same way. A step whose condition does not hold is recorded skipped; ' +
      'its assertions still apply.',
  ];
}

// The hint lines for what the scenario declares and the run never recorded
// (#335): the ids, the record line for each, and how a step that did not
// apply is recorded. An assertion's line names the step it follows and its
// type from `declaredAssertions` (the scenario's assertions, which
// `result finalize --scenario` has loaded); one it does not describe keeps
// the placeholders.
function unrecordedBlock(unrecorded, { runId, declaredAssertions = [] }) {
  if (!hasGaps(unrecorded)) return [];
  const { steps, assertions } = unrecorded;
  const named = [
    steps.length ? `steps ${steps.join(', ')}` : null,
    assertions.length ? `assertions ${assertions.join(', ')}` : null,
  ].filter(Boolean).join('; ');
  return [
    `Never recorded: ${named}. Perform each step with one-shot verbs and record it, and record each assertion after its step:`,
    ...steps.map((id) => `mauto result add-step --run-id ${runId} --step-id ${arg(id)} --status <pass|fail|skipped>`),
    ...assertions.map((id) => {
      const declared = declaredAssertions.find((a) => a && a.id === id) || {};
      const stepId = typeof declared.after_step === 'string' ? arg(declared.after_step) : '<step_id>';
      const type = typeof declared.type === 'string' ? arg(declared.type) : '<type>';
      return (
        `mauto result add-assertion --run-id ${runId} --step-id ${stepId} --assertion-id ${arg(id)} ` +
        `--type ${type} --pass <true|false> --message "<why>"`
      );
    }),
    'A step whose condition does not hold, or that was optional and missed, is recorded --status skipped; its assertions still apply.',
  ];
}

// The hint for an `incomplete` run: the pending steps, the entries never
// recorded, a block per pending class, then the re-finalize. The scenario path is the one the executor
// recorded, so the re-run and the re-finalize use the same file, printed
// absolute (resolved against `projectRoot`): --scenario resolves against the
// cwd while the workspace is discovered by walking up from it, so a
// project-relative path would be wrong from any subdirectory.
function pendingHint(result, { projectRoot, unrecorded, declaredAssertions }) {
  const { judged, references } = pendingByClass(result);
  const pendingSteps = (result.steps_executed || []).filter(isPendingStep);
  const runId = arg(result.run_id);
  const recorded = result.executor && result.executor.scenario_path;
  const scenario = recorded ? arg(path.resolve(projectRoot, recorded)) : '<scenario.json>';
  const nothingPending = judged.length + references.length === 0;
  // With gaps, "no assertion is pending" would read as "nothing left to do".
  const lastWord = hasGaps(unrecorded)
    ? 'Re-finalize once every declared step and assertion is recorded:'
    : 'No assertion is pending; re-finalize once the run is decided:';
  return [
    ...stepBlock(pendingSteps, { runId }),
    ...unrecordedBlock(unrecorded, { runId, declaredAssertions }),
    ...judgedBlock(judged, { runId }),
    ...referenceBlock(references, { projectRoot, scenario }),
    ...(nothingPending ? [lastWord] : []),
    `mauto result finalize --run-id ${runId} --scenario ${scenario}`,
  ].join('\n');
}

// The `incomplete` (exit 7) envelope, shared by `result finalize` and
// `mauto run`: the message, the store's hints, then the commands that complete
// the run. `data` is what the envelope carries; `unrecorded` is what
// `result finalize --scenario` found never recorded (#335), and
// `declaredAssertions` the scenario's assertions, which fill its record lines.
function incompleteEnvelope(result, { hints, projectRoot, data, unrecorded, declaredAssertions }) {
  return fail(
    'incomplete',
    incompleteMessage(result, { unrecorded }),
    [...hints, pendingHint(result, { projectRoot, unrecorded, declaredAssertions })].join('\n'),
    data
  );
}

module.exports = { arg, pendingAssertions, pendingHint, incompleteMessage, incompleteEnvelope };
