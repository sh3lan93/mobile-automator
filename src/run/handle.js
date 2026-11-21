'use strict';

const path = require('path');

const { ok, fail } = require('../output/envelope');
const { buildExecutor } = require('../result/executor');
const { incompleteEnvelope } = require('../result/pending-hint');
const { PLATFORM_UNKNOWN } = require('../device/bridge');
const { realClock } = require('./clock');
const { runScenario } = require('./runner');
const { NO_TRACE } = require('./trace');
const { runSettings } = require('./settings');
const { runData } = require('./summary');
const { toJUnit } = require('../result/junit');
const { atomicOutputWrite } = require('../util/atomic');
const { UnsafePathError } = require('../workspace/safe-fs');
const configManager = require('../config/manager');

// The device's platform for the executor. Null only when the bridge itself
// says it cannot report one (its PLATFORM_UNKNOWN failure) — the steps will
// fail on their own if the device is truly gone — and then `unknown` is set so
// the run's hints say so. Any other error propagates.
async function platformOf(bridge) {
  try {
    return { platform: await bridge.getPlatform(), unknown: false };
  } catch (err) {
    if (err && err.code === PLATFORM_UNKNOWN) return { platform: null, unknown: true };
    throw err;
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
    loadConfig = configManager.load,
    writeFile = atomicOutputWrite,
  },
  { scenario, runId, file, sha256, deviceId = null, timeoutMs = null, updateReferences = false, junitPath = null }
) {
  const scenarioId = scenario.scenario_id;
  // The run's timings: the optional `run` block of the workspace config, with
  // --timeout-ms as a cap on every per-step wait.
  const settings = runSettings(loadConfig(projectRoot), { timeoutMs });
  const store = resultStoreFactory({ runId, scenarioId, projectRoot });
  const { platform, unknown: platformUnknown } = await platformOf(bridge);
  const executor = buildExecutor({
    kind: 'runner',
    projectRoot,
    platform,
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
      settings,
      updateReferences,
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
  if (platformUnknown) hints.push('platform unknown: the bridge could not report it');
  const facts = {
    projectRoot,
    resultFile: finalized.file,
    failedStep: outcome.failedStep,
    failures: outcome.failures,
  };

  // --junit: the report `mauto result export --format junit` would render for
  // this run, written once the run is finalized. A failed write overrides any
  // outcome — a CI job must never upload a report that is silently missing —
  // and still names the saved result, with junit_path null. The path is the
  // user's: one that lands in the workspace is written through safe-fs, and a
  // committed link there is refused with the refusal's own message and hint
  // (#347).
  if (junitPath) {
    try {
      writeFile(projectRoot, junitPath, toJUnit([result]).xml);
    } catch (err) {
      const data = runData(result, facts);
      const saved = `${result.status} and its result is saved to ${data.result_path}.`;
      const refused = err instanceof UnsafePathError;
      return {
        envelope: fail(
          'environment',
          refused ? err.message : `could not write the JUnit report to ${junitPath}: ${err.message}`,
          [
            ...hints,
            refused ? `${err.hint} The run is ${saved}` : `Check the directory exists and is writable; the run is ${saved}`,
          ].join(' '),
          data
        ),
        exitKind: 'environment',
      };
    }
  }

  const data = runData(result, { ...facts, junitPath });
  const resultPath = data.result_path;

  if (result.status === 'passed') {
    return { envelope: ok(data, hints.length ? hints.join(' ') : null), exitKind: 'ok' };
  }
  // Exit 7: nothing failed, but an agent still has to judge something. The
  // hint is the exact commands that complete the run, as finalize's is.
  if (result.status === 'incomplete') {
    return {
      envelope: incompleteEnvelope(result, { hints, projectRoot, data }),
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
