'use strict';

const path = require('path');

const { ok, fail } = require('../output/envelope');
const { realClock } = require('./clock');
const { runScenario } = require('./runner');
const { NO_TRACE } = require('./trace');

// `mauto run` (replay PRD #271, slice R1 #278): replay a scenario in-process
// against the one bridge connectBridge holds open, then finalize through the
// same finalizeRun `mauto result finalize` uses — injected by src/cli.js,
// which owns it, so this module never requires the CLI. No --status: the
// store derives it from the recorded steps and assertions, and the exit code
// is keyed on that derived status, as finalize's is. `prepared` is what
// prepareRun resolved before any device work: the loaded scenario and the
// run id.
async function handleRun(
  {
    bridge, resultStoreFactory, memoryStoreFactory, projectRoot, finalizeRun,
    trace = NO_TRACE, clock = realClock,
    evaluator = require('../assertion/evaluator'),
    catalog = require('../device/action-catalog'),
  },
  { scenario, runId }
) {
  const scenarioId = scenario.scenario_id;
  const store = resultStoreFactory({ runId, scenarioId, projectRoot });
  const finalize = () => finalizeRun(
    { resultStoreFactory, memoryStoreFactory, projectRoot },
    { runId, scenarioId }
  );

  let outcome;
  try {
    outcome = await runScenario({
      scenario,
      bridge,
      store,
      evaluator,
      catalog,
      projectRoot,
      runId,
      clock,
      trace,
    });
  } catch (err) {
    // An unexpected error (a store write, a bug) still ends the run
    // finalized — never left `_in_progress` — and then reaches withEnvelope
    // as the error it was. A finalize that fails too must not replace it.
    try {
      finalize();
    } catch {
      // The original error is the one worth reporting.
    }
    throw err;
  }

  const { result, store: finalized, hints } = finalize();
  const resultPath = path.relative(projectRoot, finalized.file);
  const data = {
    run_id: runId,
    scenario_id: scenarioId,
    status: result.status,
    result_path: resultPath,
    failed_step: outcome.failedStep,
    failures: outcome.failures,
    measurements: result.measurements,
  };

  if (result.status === 'passed') {
    return { envelope: ok(data, hints.length ? hints.join(' ') : null), exitKind: 'ok' };
  }
  const hint = [...hints, `See data.failures; the result is saved to ${resultPath}.`].join(' ');
  return {
    envelope: fail('test_failed', `run ${runId} ${result.status}`, hint, data),
    exitKind: 'test_failed',
  };
}

module.exports = { handleRun };
