'use strict';

const path = require('path');

const { ok, fail } = require('../output/envelope');
const { buildExecutor, pendingAssertions, pendingHint, incompleteMessage } = require('../result/provenance');
const { realClock } = require('./clock');
const { runScenario } = require('./runner');
const { NO_TRACE } = require('./trace');

// The device's platform for the executor. Best-effort by design (the one
// fallback here): a bridge that cannot say must not stop the run — the steps
// will fail on their own if the device is truly gone — so it is recorded null.
async function platformOf(bridge) {
  try {
    return await bridge.getPlatform();
  } catch {
    return null;
  }
}

// `mauto run` (replay PRD #271, slice R1 #278): replay a scenario in-process
// against the one bridge connectBridge holds open, then finalize through the
// same finalizeRun `mauto result finalize` uses — injected by src/cli.js,
// which owns it, so this module never requires the CLI. No --status: the
// store derives it from the recorded steps and assertions, and the exit code
// is keyed on that derived status, as finalize's is. `prepared` is what
// prepareRun resolved before any device work — the loaded scenario, its file
// and sha256, and the run id — plus the device id the CLI resolved (null when
// mobile-mcp auto-selects). The result records them as its executor (#275).
// `cwd` is the directory a relative scenario path is resolved against.
async function handleRun(
  {
    bridge, resultStoreFactory, memoryStoreFactory, projectRoot, finalizeRun,
    cwd = process.cwd(), trace = NO_TRACE, clock = realClock,
    evaluator = require('../assertion/evaluator'),
    catalog = require('../device/action-catalog'),
  },
  { scenario, runId, file, sha256, deviceId = null }
) {
  const scenarioId = scenario.scenario_id;
  const store = resultStoreFactory({ runId, scenarioId, projectRoot });
  const executor = buildExecutor({
    kind: 'runner',
    projectRoot,
    platform: await platformOf(bridge),
    deviceId,
    // Resolved against the cwd the verb ran in, as the file was read;
    // buildExecutor decides how it is recorded.
    scenarioPath: path.resolve(cwd, file),
    scenarioSha256: sha256,
  });
  const finalize = () => finalizeRun(
    { resultStoreFactory, memoryStoreFactory, projectRoot },
    { runId, scenarioId, executor }
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
    // What an agent still has to judge; empty unless the run is incomplete
    // or failed beside a pending assertion.
    pending: pendingAssertions(result),
    executor: result.executor,
    measurements: result.measurements,
  };

  if (result.status === 'passed') {
    return { envelope: ok(data, hints.length ? hints.join(' ') : null), exitKind: 'ok' };
  }
  // Exit 7: nothing failed, but an agent still has to judge something. The
  // hint is the exact commands that complete the run, as finalize's is.
  if (result.status === 'incomplete') {
    return {
      envelope: fail('incomplete', incompleteMessage(result), [...hints, pendingHint(result, { projectRoot })].join('\n'), data),
      exitKind: 'incomplete',
    };
  }
  const hint = [...hints, `See data.failures; the result is saved to ${resultPath}.`].join(' ');
  return {
    envelope: fail('test_failed', `run ${runId} ${result.status}`, hint, data),
    exitKind: 'test_failed',
  };
}

module.exports = { handleRun };
