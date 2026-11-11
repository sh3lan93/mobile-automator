'use strict';

// The in-process scenario runner behind `mauto run`: an in-process port of
// the real-device harness executor (sample-app/scripts/lib/executor.js). It
// drives one held-open DeviceBridge and records through one ResultStore. It
// never spawns a process, never emits an envelope and never finalizes or
// decides the run's status: the CLI's finalizeRun does that, shared with
// `mauto result finalize`.
//
// Everything with a side effect is injected (bridge, store, clock, log,
// trace), which is what lets tests/unit/run drive it on a fake bridge and a
// fake clock.

const { runStep } = require('./step');
const { runAssertion } = require('./assertions');
const { NO_TRACE } = require('./trace');

// Best-effort: a store that cannot take this write must not replace the
// error that is about to propagate.
function recordAbort(store, step, err) {
  if (!step) return;
  try {
    store.addStep({ step_id: step.id, status: 'error', error_message: `mauto run aborted: ${err && err.message}` });
  } catch {
    // The original error is the one worth reporting.
  }
}

async function runScenario({
  scenario, bridge, store, evaluator, catalog, projectRoot, runId, clock,
  log = () => {}, trace = NO_TRACE,
}) {
  const failures = [];
  const ctx = { scenario, bridge, store, evaluator, catalog, projectRoot, runId, clock, log, trace, failures };
  const assertions = Array.isArray(scenario.assertions) ? scenario.assertions : [];
  // The first step that failed, if any.
  let failedStep = null;

  // The step being run when an unexpected error (a store write, a bug)
  // escapes: it is recorded as `error` before the error propagates, so the
  // result says the run aborted and where.
  let current = null;
  try {
    trace.start();
    for (const step of scenario.steps || []) {
      current = step;
      log(`[${scenario.scenario_id}] step ${step.id} (${step.action})`);
      const outcome = await runStep(step, ctx);
      if (!outcome.ok) {
        failures.push(`step ${step.id} (${step.action}): ${outcome.error.message}`);
        failedStep = step.id;
        // Later steps would run against a screen nobody predicted; their
        // failures would only bury this one.
        break;
      }
      for (const assertion of assertions.filter((a) => a.after_step === step.id)) {
        await runAssertion(assertion, ctx);
      }
    }
  } catch (err) {
    recordAbort(store, current, err);
    throw err;
  }

  // No status: what a run's records add up to is defined once, by
  // deriveRunStatus (src/result/outcome.js), applied when finalizeRun
  // finalizes the store.
  return { failures, failedStep };
}

module.exports = { runScenario };
