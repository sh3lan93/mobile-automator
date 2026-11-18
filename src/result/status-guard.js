'use strict';

const { deriveRunStatus } = require('./outcome');
const { ResultStoreRefusal } = require('./refusal');
const { unrecordedEntries, hasUnrecorded, describeUnrecorded } = require('./scenario-check');

// The status `result finalize` writes, decided once (#275 review B1, #335,
// #337). ResultStore#finalize calls this under its lock with the entries it
// just re-read, so the decision is made from exactly what the file is written
// with. An agent may make a run worse than the status derived from what was
// recorded, never greener. Severity, least to most:
// passed < incomplete < failed < error.
//
// - With no explicit `status`, the derived one is written.
// - An explicit status is allowed when it equals the derived one, or is
//   strictly more severe — with one exception: `incomplete` is a derived-only
//   state (it means "something recorded is pending"), so it is allowed only
//   when the derived status is itself `incomplete`.
// - A `passed` over a run with nothing recorded (zero steps AND zero
//   assertions) proves nothing, so it is refused — unless the caller loaded
//   the `--scenario` and that scenario declares zero assertions.
// - With `scenario`, what it declares and the run never recorded (#335)
//   derives the run `incomplete` unless it is already failing, so `passed` is
//   refused there and `incomplete` allowed.
//
// Returns the status to write; throws StatusRefusedError for one it refuses.
const SEVERITY = Object.freeze({ passed: 0, incomplete: 1, failed: 2, error: 3 });

class StatusRefusedError extends ResultStoreRefusal {}

function resolveRunStatus({ status, steps = [], assertions = [], scenario } = {}) {
  const unrecorded = scenario ? unrecordedEntries({ steps, assertions }, scenario) : null;
  const derived = deriveRunStatus(steps, assertions, unrecorded);
  if (status === undefined) return derived;

  const empty = steps.length === 0 && assertions.length === 0;
  const declaresNoAssertions = Boolean(scenario) && (scenario.assertions || []).length === 0;
  if (status === 'passed' && empty && !declaresNoAssertions) {
    throw new StatusRefusedError(
      'cannot finalize --status passed: nothing recorded for this run (no steps and no assertions)',
      'Record the run with `mauto result add-step` / `add-assertion` first, or omit --status. ' +
        'An empty run may be finalized passed only with --scenario naming a scenario that declares no assertions.'
    );
  }

  const allowed = status === 'incomplete' ? derived === 'incomplete' : SEVERITY[status] >= SEVERITY[derived];
  if (allowed) return status;

  // Refused over a run that derives incomplete with gaps: name them, since
  // recording them is what completes it.
  if (derived === 'incomplete' && hasUnrecorded(unrecorded)) {
    throw new StatusRefusedError(
      `cannot finalize --status ${status}: the scenario declares entries this run never recorded: ${describeUnrecorded(unrecorded)}`,
      'A run that never recorded part of its scenario derives "incomplete". Record each with ' +
        '`mauto result add-step` / `add-assertion` (a step that did not apply is recorded --status skipped), ' +
        'omit --status, or finalize --status incomplete, failed or error.'
    );
  }

  throw new StatusRefusedError(
    `cannot finalize --status ${status}: the recorded steps and assertions derive "${derived}"`,
    `An explicit --status may equal the derived status ("${derived}") or make the run worse (failed, error), ` +
      'never better. Omit --status to use the derived one, or record the missing verdicts first.'
  );
}

module.exports = { resolveRunStatus, StatusRefusedError, SEVERITY };
