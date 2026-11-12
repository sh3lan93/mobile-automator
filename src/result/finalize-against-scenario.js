'use strict';

// The scenario-aware half of `mauto result finalize` (#275): load and hash the
// scenario, cross-check the recorded run against it, guard an explicit
// --status, build the executor, finalize, and map the finalized status to an
// envelope. Flag parsing stays with the caller. `finalizeRun` is injected so
// this module never requires src/cli.js, which owns it.

const path = require('path');

const { ok, fail } = require('../output/envelope');
const { loadScenario } = require('../scenario/load');
const { scenarioMismatch, buildExecutor, incompleteEnvelope } = require('./provenance');
const { checkExplicitStatus } = require('./status-guard');

function finalizeAgainstScenario(
  { validator, resultStoreFactory, memoryStoreFactory, projectRoot, cwd = process.cwd(), finalizeRun },
  opts
) {
  const { runId, scenarioId, status, duration } = opts;

  // --scenario (#275): the result is checked against the file it claims and
  // the file is hashed into `executor`. Refused before anything is written.
  // Resolved against the caller's cwd, as handleScreenshot resolves its path;
  // buildExecutor decides how it is recorded.
  let scenarioPath = null;
  let scenarioSha256 = null;
  let scenarioAssertionCount;
  if (opts.scenario !== undefined) {
    const scenarioFile = path.resolve(cwd, opts.scenario);
    const loaded = loadScenario(validator, scenarioFile, { strict: false });
    if (loaded.failure) return loaded.failure;
    const mismatch = scenarioMismatch(resultStoreFactory({ runId, scenarioId, projectRoot }).recorded(), loaded);
    if (mismatch) {
      return { envelope: fail('invalid_input', mismatch.message, mismatch.hint, mismatch.data), exitKind: 'invalid_input' };
    }
    scenarioPath = scenarioFile;
    scenarioSha256 = loaded.sha256;
    scenarioAssertionCount = Array.isArray(loaded.scenario.assertions) ? loaded.scenario.assertions.length : 0;
  }

  // An explicit --status may equal the derived one or make the run worse,
  // never greener (src/result/status-guard.js). Refused before anything is
  // written.
  if (status !== undefined) {
    const recorded = resultStoreFactory({ runId, scenarioId, projectRoot }).recorded();
    const refusal = checkExplicitStatus({
      status, steps: recorded.steps, assertions: recorded.assertions, scenarioAssertionCount,
    });
    if (refusal) {
      return { envelope: fail('invalid_input', refusal.message, refusal.hint), exitKind: 'invalid_input' };
    }
  }

  // Only provided keys: `defaultMetadata` fills the rest with 'unknown', and
  // the result schema requires all five fields to be strings, so threading
  // `undefined` through would break conformance.
  const metadata = {};
  if (opts.appVersion !== undefined) metadata.app_version = opts.appVersion;
  if (opts.deviceModel !== undefined) metadata.device_model = opts.deviceModel;
  if (opts.apiLevel !== undefined) metadata.api_level = opts.apiLevel;
  if (opts.environment !== undefined) metadata.environment = opts.environment;

  const { result, store, hints } = finalizeRun(
    { resultStoreFactory, memoryStoreFactory, projectRoot },
    {
      runId, scenarioId, status, duration, metadata, summary: opts.summary,
      // No device is connected here, so none is claimed (plan decision 5).
      executor: buildExecutor({ kind: 'agent', projectRoot, scenarioPath, scenarioSha256 }),
    }
  );

  // Exit 7: nothing failed, but an agent still has to judge something. The
  // file is written; the hint is the exact commands that complete it.
  if (result.status === 'incomplete') {
    return { envelope: incompleteEnvelope(result, { hints, projectRoot, data: result }), exitKind: 'incomplete' };
  }

  // The exit code is keyed on the FINALIZED status, not the --status flag:
  // with the flag omitted, the store derives it from the recorded steps and
  // assertions ('error' for an errored step, else 'failed' for a failed step or
  // assertion, #296), and the exit code must agree with the file either way
  // (#273). 'error' takes the same path — a run that errored is not a pass for
  // CI either; data.status tells the two apart. Everything above (write, retention, harvest) has
  // already run: exit 6 is a verdict about the app, not a reason to lose the
  // record of it.
  if (result.status === 'failed' || result.status === 'error') {
    const hint = hints.length
      ? hints.join(' ')
      : 'See data.steps_executed and data.assertion_results for what failed; ' +
        `the result is saved to ${path.relative(projectRoot, store.file)}.`;
    return {
      envelope: fail('test_failed', `run ${runId} ${result.status}`, hint, result),
      exitKind: 'test_failed',
    };
  }

  return { envelope: ok(result, hints.length ? hints.join(' ') : null), exitKind: 'ok' };
}

module.exports = { finalizeAgainstScenario };
