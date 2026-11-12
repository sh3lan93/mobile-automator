'use strict';

// What an agent must do to complete a run that is waiting for its judgment
// (#275): the pending assertions, the `incomplete` message and hint, and the
// envelope built from them. Shared by `result finalize` and `mauto run`.

const path = require('path');

const { fail } = require('../output/envelope');
const { isPendingAssertion } = require('./outcome');

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

module.exports = { arg, pendingAssertions, pendingHint, incompleteMessage, incompleteEnvelope };
