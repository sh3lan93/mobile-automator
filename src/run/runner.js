'use strict';

// The in-process scenario runner behind `mauto run`: an in-process port of
// the real-device harness executor (sample-app/scripts/lib/executor.js). It
// drives one held-open DeviceBridge and records through one ResultStore. It
// never spawns a process, never emits an envelope and never finalizes or
// decides the run's status: the CLI's finalizeRun does that, shared with
// `mauto result finalize`.
//
// Everything with a side effect is injected (bridge, store, clock, trace), which is what lets tests/unit/run drive it on a fake bridge and a
// fake clock.

const { runStep } = require('./step');
const { handlerFor } = require('./actions');
const { preconditionHandlerFor } = require('./actions/preconditions');
const { runAssertion } = require('./assertions');
const { NO_TRACE } = require('./trace');
const { makePollUntil } = require('./poll');

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
  trace = NO_TRACE, settings,
}) {
  const failures = [];
  // `variables` is the run's captured values, which the assertions' evaluator
  // reads (value_matches_variable); `settings` the run's timings and limits.
  const variables = {};
  // `pollUntil` is how every waiting handler looks at the screen.
  const pollUntil = makePollUntil(settings, clock);
  // `statuses` is each step's recorded status so far (a `previous_step_skipped`
  // condition reads it); `previous` the screen before a step, kept only for the
  // steps a text_changed assertion follows (`wantsPrevious`), so every other
  // scenario pays no extra device call.
  const statuses = new Map();
  const previous = new Map();
  const assertions = Array.isArray(scenario.assertions) ? scenario.assertions : [];
  const wantsPrevious = new Set(assertions.filter((a) => a.type === 'text_changed').map((a) => a.after_step));
  const ctx = {
    scenario, bridge, store, evaluator, catalog, projectRoot, runId, clock, trace, failures, settings, variables, pollUntil,
    statuses, previous, wantsPrevious,
  };
  // The assertions that follow a step, once it (and its sub_steps) is done.
  ctx.afterStep = async (stepId) => {
    for (const assertion of assertions.filter((a) => a.after_step === stepId)) {
      await runAssertion(assertion, ctx, previous.get(stepId) || null);
    }
  };
  // The first step that failed, if any.
  let failedStep = null;

  // The step being run when an unexpected error (a store write, a bug)
  // escapes: it is recorded as `error` before the error propagates, so the
  // result says the run aborted and where.
  let current = null;
  try {
    trace.start();
    // Preconditions first, each a synthetic step `precondition_<n>` (1-based
    // position in device_actions), through the same runStep.
    const deviceActions = scenario.preconditions && scenario.preconditions.device_actions;
    const setup = (Array.isArray(deviceActions) ? deviceActions : []).map((a, i) => {
      const step = { ...a, id: `precondition_${i + 1}` };
      return { step, perform: preconditionHandlerFor(step.action) };
    });
    const queue = [...setup, ...(scenario.steps || []).map((step) => ({ step, perform: handlerFor(step.action) }))];
    for (const { step, perform } of queue) {
      current = step;
      const outcome = await runStep(step, ctx, perform);
      // A step only an agent can do is recorded, not failed; whatever follows
      // would run on a state nobody established, so the run ends here and
      // finalizes incomplete.
      if (outcome.kind === 'needs_agent') break;
      if (outcome.kind === 'failed') {
        failures.push(`step ${step.id} (${step.action}): ${outcome.error.message}`);
        failedStep = step.id;
        // Later steps would run against a screen nobody predicted; their
        // failures would only bury this one.
        break;
      }
      // A skipped step (a false condition, an optional miss) still has its
      // assertions run: they describe the screen the scenario expects either way.
      await ctx.afterStep(step.id);
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
