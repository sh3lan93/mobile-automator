'use strict';

// The `data` of every `mauto run` envelope (replay R6, #282) — exit 0, 6 and
// 7, and the environment failure of a JUnit write — frozen: exactly
// RUN_DATA_KEYS, in that order. A CI job parses it, so a key is never added,
// dropped or renamed without a deliberate change here and in its test.
// `measurements` deliberately stays out: it lives in the result file.

const path = require('path');

const {
  isFailedStep, isErroredStep, isPendingStep, isFailingAssertion, isPendingAssertion,
} = require('../result/outcome');
const { pendingAssertions } = require('../result/pending-hint');

const RUN_DATA_KEYS = Object.freeze([
  'run_id', 'scenario_id', 'status', 'result_path', 'duration_seconds', 'steps', 'assertions',
  'failed_step', 'failures', 'pending', 'junit_path', 'executor',
]);

const asList = (value) => (Array.isArray(value) ? value : []);

// A partition of steps_executed: one entry per step, each in one bucket. A
// needs_agent step (status `skipped` + needs_agent) counts only as needs_agent.
function stepCounts(steps) {
  const counts = { total: steps.length, passed: 0, failed: 0, error: 0, skipped: 0, needs_agent: 0 };
  for (const step of steps) {
    if (isPendingStep(step)) counts.needs_agent += 1;
    else if (isFailedStep(step)) counts.failed += 1;
    else if (isErroredStep(step)) counts.error += 1;
    else if (step && step.status === 'skipped') counts.skipped += 1;
    else counts.passed += 1;
  }
  return counts;
}

function assertionCounts(assertions) {
  const counts = { total: assertions.length, passed: 0, failed: 0, needs_agent: 0 };
  for (const assertion of assertions) {
    if (isPendingAssertion(assertion)) counts.needs_agent += 1;
    else if (isFailingAssertion(assertion)) counts.failed += 1;
    else counts.passed += 1;
  }
  return counts;
}

// `result` is the finalized result; `resultFile` its absolute path, reported
// relative to `projectRoot`; `failedStep` / `failures` are the runner's;
// `junitPath` the absolute path of a written JUnit report, else null.
function runData(result, { projectRoot, resultFile, failedStep = null, failures = [], junitPath = null }) {
  return {
    run_id: result.run_id,
    scenario_id: result.scenario_id,
    status: result.status,
    result_path: path.relative(projectRoot, resultFile),
    duration_seconds: Number(result.duration_seconds) || 0,
    steps: stepCounts(asList(result.steps_executed)),
    assertions: assertionCounts(asList(result.assertion_results)),
    failed_step: failedStep == null ? null : failedStep,
    failures: asList(failures),
    // What an agent still has to judge; empty unless the run is incomplete
    // or failed beside a pending assertion.
    pending: pendingAssertions(result),
    junit_path: junitPath,
    executor: result.executor,
  };
}

module.exports = { runData, RUN_DATA_KEYS };
