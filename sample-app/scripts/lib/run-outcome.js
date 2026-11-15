'use strict';

// What the real-device E2E harness reads off a `mauto run` result file (#283).
//
// The harness no longer executes scenarios; the shipped runner does, and its
// result file is the record. outcomeOf turns that file into the three facts
// the harness classifies on (lib/known-failures.js):
//
//   passed      only `status: 'passed'`. An `incomplete` run (a step or an
//               assertion needed an agent) is NOT a pass: CI has no agent.
//   failedStep  the step_id of the FIRST step whose status is failed or error
//               — what a known failure's `failing_step` is pinned to — else
//               null (a run can fail on an assertion alone).
//   details     human lines for the summary: each failing step's message,
//               each failed assertion's message, each unjudged assertion.
//
// Field names are the result schema's (`mauto schema result`). Kept free of
// src/ requires so the harness reads any install's results the same way;
// malformed entries are skipped, never thrown on.

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const listOf = (v) => (Array.isArray(v) ? v.filter(isObject) : []);
const isFailingStep = (s) => s.status === 'failed' || s.status === 'error';

function outcomeOf(result) {
  const r = isObject(result) ? result : {};
  const steps = listOf(r.steps_executed);
  const assertions = listOf(r.assertion_results);

  const failing = steps.filter(isFailingStep);
  const details = failing.map((s) => `${s.step_id}: ${s.error_message || `step ${s.status}`}`);
  for (const a of assertions) {
    if (a.status === 'failed') details.push(`${a.assertion_id}: ${a.message || 'assertion failed'}`);
    else if (a.status === 'needs_agent') details.push(`${a.assertion_id}: needs an agent (not judged)`);
  }

  return {
    passed: r.status === 'passed',
    failedStep: failing.length ? failing[0].step_id : null,
    details,
  };
}

module.exports = { outcomeOf };
