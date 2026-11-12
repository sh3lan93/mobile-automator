'use strict';

const { deriveRunStatus } = require('./outcome');

// The rule for `result finalize --status <explicit>` (#275 review, B1): an
// agent may make a run worse than the status derived from what was recorded,
// never greener. Severity, least to most: passed < incomplete < failed < error.
//
// - An explicit status is allowed when it equals the derived one, or is
//   strictly more severe — with one exception: `incomplete` is a derived-only
//   state (it means "something recorded is pending"), so it is allowed only
//   when the derived status is itself `incomplete`.
// - A `passed` over a run with nothing recorded (zero steps AND zero
//   assertions) proves nothing, so it is refused — unless the caller loaded
//   the `--scenario` and that scenario declares zero assertions
//   (`scenarioAssertionCount === 0`).
//
// Returns null when the status may be written, else `{message, hint}`.
const SEVERITY = Object.freeze({ passed: 0, incomplete: 1, failed: 2, error: 3 });

function checkExplicitStatus({ status, steps = [], assertions = [], scenarioAssertionCount } = {}) {
  if (status === undefined) return null;
  const derived = deriveRunStatus(steps, assertions);
  const empty = steps.length === 0 && assertions.length === 0;

  if (status === 'passed' && empty && scenarioAssertionCount !== 0) {
    return {
      message: 'cannot finalize --status passed: nothing recorded for this run (no steps and no assertions)',
      hint:
        'Record the run with `mauto result add-step` / `add-assertion` first, or omit --status. ' +
        'An empty run may be finalized passed only with --scenario naming a scenario that declares no assertions.',
    };
  }

  const allowed = status === 'incomplete' ? derived === 'incomplete' : SEVERITY[status] >= SEVERITY[derived];
  if (allowed) return null;

  return {
    message: `cannot finalize --status ${status}: the recorded steps and assertions derive "${derived}"`,
    hint:
      `An explicit --status may equal the derived status ("${derived}") or make the run worse (failed, error), ` +
      'never better. Omit --status to use the derived one, or record the missing verdicts first.',
  };
}

module.exports = { checkExplicitStatus, SEVERITY };
