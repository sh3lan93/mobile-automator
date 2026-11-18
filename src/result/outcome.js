'use strict';

// What counts as a failure in a result file — the one definition shared by
// `result finalize` (src/result/store.js, which derives the run status and
// counts) and the JUnit export (src/result/junit.js, which decides which
// entries render a <failure>). Keeping both on these predicates is what stops
// the result file and its export disagreeing (#296); the cross-check in
// tests/unit/result/outcome.test.js renders derived statuses through toJUnit.
//
// The predicates take anything: the JUnit renderer reads older and
// hand-edited files, so a null or non-object entry is simply not failing.

const { hasUnrecorded } = require('./scenario-check');

const statusOf = (entry) => (entry !== null && typeof entry === 'object' ? entry.status : undefined);

const isPassedStep = (step) => statusOf(step) === 'passed';
const isSkippedStep = (step) => statusOf(step) === 'skipped';
const isFailedStep = (step) => statusOf(step) === 'failed';
const isErroredStep = (step) => statusOf(step) === 'error';
const isFailingStep = (step) => isFailedStep(step) || isErroredStep(step);
const isPassedAssertion = (assertion) => statusOf(assertion) === 'passed';
const isFailingAssertion = (assertion) => statusOf(assertion) === 'failed';

// Pending (#275): recorded, but not decided, because only an agent can judge
// it. An assertion says so with its status; a step keeps its own status and
// carries `needs_agent: true` beside it.
const isPendingAssertion = (assertion) => statusOf(assertion) === 'needs_agent';
const isPendingStep = (step) => step !== null && typeof step === 'object' && step.needs_agent === true;

// The run status `result finalize` derives when `--status` is omitted (#296).
// It used to read assertions only, so a run whose step failed finalized
// `passed` while its JUnit export was red. Every entry counts — a step
// recorded twice (fail, then pass) still failed once, matching the export.
// Skipped steps count for nothing; a run with no steps and no assertions
// stays `passed`. Anything failing outranks anything pending: a run that is
// already red is decided, whatever an agent later says (#275).
//
// `unrecorded` (#335) is what `result finalize --scenario` found the scenario
// declares and the run never recorded (unrecordedEntries in
// src/result/scenario-check.js), else null. Any entry in it keeps the run
// from passing: it derives `incomplete`, like a pending one. A failing run is
// decided whatever it lacks, since the steps after a failure never ran.
//
// This is the one definition of run status: ResultStore#finalize applies it
// under its lock, and status-guard.js checks an explicit --status against it.
function deriveRunStatus(steps = [], assertions = [], unrecorded = null) {
  if (steps.some(isErroredStep)) return 'error';
  if (steps.some(isFailedStep)) return 'failed';
  if (assertions.some(isFailingAssertion)) return 'failed';
  if (steps.some(isPendingStep) || assertions.some(isPendingAssertion)) return 'incomplete';
  if (hasUnrecorded(unrecorded)) return 'incomplete';
  return 'passed';
}

module.exports = {
  isPassedStep,
  isSkippedStep,
  isFailedStep,
  isErroredStep,
  isFailingStep,
  isPassedAssertion,
  isFailingAssertion,
  isPendingAssertion,
  isPendingStep,
  deriveRunStatus,
};
