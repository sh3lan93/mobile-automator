'use strict';

// The scenario-aware half of `mauto result finalize` (#275): load and hash the
// scenario, cross-check the recorded run against it, guard an explicit
// --status, build the executor, finalize, and map the finalized status to an
// envelope. Flag parsing stays with the caller. `finalizeRun` is injected so
// this module never requires src/cli.js, which owns it.

const path = require('path');

const { ok, fail } = require('../output/envelope');
const { loadScenario } = require('../scenario/load');
const { scenarioMismatch, unrecordedEntries } = require('./scenario-check');
const { deriveRunStatus } = require('./outcome');
const { buildExecutor } = require('./executor');
const { incompleteEnvelope } = require('./pending-hint');
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
  // What the run recorded, and what the scenario declares that it never did
  // (#335); both null without --scenario.
  let recorded = null;
  let unrecorded = null;
  // The scenario's assertions, which fill the hint's record lines (#335).
  let declaredAssertions = [];
  if (opts.scenario !== undefined) {
    const scenarioFile = path.resolve(cwd, opts.scenario);
    const loaded = loadScenario(validator, scenarioFile, { strict: false });
    if (loaded.failure) return loaded.failure;
    recorded = resultStoreFactory({ runId, scenarioId, projectRoot }).recorded();
    const mismatch = scenarioMismatch(recorded, loaded);
    if (mismatch) {
      return { envelope: fail('invalid_input', mismatch.message, mismatch.hint, mismatch.data), exitKind: 'invalid_input' };
    }
    unrecorded = unrecordedEntries(recorded, loaded.scenario);
    scenarioPath = scenarioFile;
    scenarioSha256 = loaded.sha256;
    declaredAssertions = Array.isArray(loaded.scenario.assertions) ? loaded.scenario.assertions : [];
    scenarioAssertionCount = declaredAssertions.length;
  }

  // An explicit --status may equal the derived one or make the run worse,
  // never greener (src/result/status-guard.js). Refused before anything is
  // written.
  if (status !== undefined) {
    const { steps, assertions } = recorded || resultStoreFactory({ runId, scenarioId, projectRoot }).recorded();
    const refusal = checkExplicitStatus({
      status, steps, assertions, scenarioAssertionCount, unrecorded,
    });
    if (refusal) {
      return { envelope: fail('invalid_input', refusal.message, refusal.hint), exitKind: 'invalid_input' };
    }
  }

  // Gaps matter only to a run its records would decide green (#335): a run
  // with a declared step or assertion never recorded is not a pass, so with
  // --status omitted it finalizes `incomplete`. A failed or errored run is
  // decided whatever it lacks (later steps legitimately never ran), so its
  // gaps are not reported; a run already pending reports them, since they
  // are part of what the agent still has to do.
  let effectiveStatus = status;
  let gaps = null;
  if (unrecorded && unrecorded.steps.length + unrecorded.assertions.length > 0) {
    const derived = deriveRunStatus(recorded.steps, recorded.assertions);
    if (derived === 'passed' || derived === 'incomplete') gaps = unrecorded;
    if (status === undefined && derived === 'passed') effectiveStatus = 'incomplete';
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
      runId, scenarioId, status: effectiveStatus, duration, metadata, summary: opts.summary,
      // No device is connected here, so none is claimed (plan decision 5).
      executor: buildExecutor({ kind: 'agent', projectRoot, scenarioPath, scenarioSha256 }),
    }
  );

  // Exit 7: nothing failed, but an agent still has to judge something. The
  // file is written; the hint is the exact commands that complete it.
  // `data.unrecorded` (#335) sits beside the result fields, never in the file.
  if (result.status === 'incomplete') {
    const data = gaps ? { ...result, unrecorded: gaps } : result;
    return {
      envelope: incompleteEnvelope(result, { hints, projectRoot, data, unrecorded: gaps, declaredAssertions }),
      exitKind: 'incomplete',
    };
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
