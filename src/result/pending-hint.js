'use strict';

// What an agent must do to complete a run that is waiting for its judgment
// (#275): the pending assertions, the `incomplete` message and hint, and the
// envelope built from them. Shared by `result finalize` and `mauto run`.

const path = require('path');

const { fail } = require('../output/envelope');
const { isPendingAssertion, isPendingStep } = require('./outcome');

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

// The pending assertion types an agent must not decide: a pending
// screenshot_match has no reference screenshot yet, and a missing baseline is
// never judged by eye (#327). Its way forward is recording the baseline, once
// the user confirms the screen, or leaving it pending.
const REFERENCE_PENDING_TYPES = new Set(['screenshot_match']);

// The `result add-assertion` line for one pending assertion, with `verdict`
// as its trailing flags.
const addAssertionLine = (runId, p, verdict) =>
  `mauto result add-assertion --run-id ${runId} --step-id ${p.step_id == null ? '<step_id>' : arg(p.step_id)} ` +
  `--assertion-id ${arg(p.assertion_id)} --type ${p.type == null ? '<type>' : arg(p.type)} ${verdict}`;

// The hint for an `incomplete` run: the pending ids, the exact
// `result add-assertion` line per pending assertion (only the verdict and the
// reason left to fill), then the re-finalize. A pending screenshot_match gets
// the re-run that records its baseline instead of a verdict to fill (#327).
// The scenario path is the one the executor recorded, so the re-run and the
// re-finalize use the same file, printed absolute (resolved against
// `projectRoot`): --scenario resolves against the cwd while the workspace is
// discovered by walking up from it, so a project-relative path would be wrong
// from any subdirectory.
function pendingHint(result, { projectRoot }) {
  const pending = pendingAssertions(result);
  const judged = pending.filter((p) => !REFERENCE_PENDING_TYPES.has(p.type));
  const references = pending.filter((p) => REFERENCE_PENDING_TYPES.has(p.type));
  const pendingSteps = (result.steps_executed || []).filter(isPendingStep);
  const runId = arg(result.run_id);
  const recorded = result.executor && result.executor.scenario_path;
  const scenario = recorded ? arg(path.resolve(projectRoot, recorded)) : '<scenario.json>';
  return [
    ...pendingSteps.map((s) => `Pending step ${s.step_id}: ${s.error_message || 'needs an agent'}`),
    ...(judged.length
      ? [
          `Pending agent judgment: ${judged.map((p) => p.assertion_id).join(', ')}. Decide each, then re-finalize:`,
          ...judged.map((p) => addAssertionLine(runId, p, '--pass <true|false> --judge agent --message "<why>"')),
        ]
      : []),
    ...(references.length
      ? [
          `Pending reference screenshot: ${references.map((p) => p.assertion_id).join(', ')}. Never judge it by eye. ` +
            'Once the user confirms the screen is correct, record the baseline under a new run id:',
          `mauto run ${scenario} --update-references`,
          'Otherwise leave it pending:',
          ...references.map((p) => addAssertionLine(runId, p, '--pass pending --message "<why>"')),
        ]
      : []),
    ...(pending.length ? [] : ['No assertion is pending; re-finalize once the run is decided:']),
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
