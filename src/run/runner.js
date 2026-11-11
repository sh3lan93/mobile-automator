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

async function runScenario({
  scenario, bridge, store, evaluator, catalog, projectRoot, runId, clock,
  log = () => {}, trace = NO_TRACE,
}) {
  const failures = [];
  const ctx = { scenario, bridge, store, evaluator, catalog, projectRoot, runId, clock, log, trace, failures };
  const assertions = Array.isArray(scenario.assertions) ? scenario.assertions : [];
  // The first step that failed, if any.
  let failedStep = null;

  trace.start();
  for (const step of scenario.steps || []) {
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

  // No status: what a run's records add up to is defined once, by
  // deriveRunStatus (src/result/outcome.js), applied when finalizeRun
  // finalizes the store.
  return { failures, failedStep };
}

module.exports = { runScenario };
