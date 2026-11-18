'use strict';

// The scenario-aware half of `mauto result finalize` (#275): load and hash the
// scenario, cross-check the recorded run against it, guard an explicit
// --status, build the executor, finalize, and map the finalized status to an
// envelope. Flag parsing stays with the caller. `finalizeRun` is injected so
// this module never requires src/cli.js, which owns it.

const path = require('path');

const { ok, fail } = require('../output/envelope');
const { loadScenario } = require('../scenario/load');
const { scenarioMismatch, unrecordedEntries, hasUnrecorded } = require('./scenario-check');
const { buildExecutor } = require('./executor');
const { incompleteEnvelope } = require('./pending-hint');
const { checkExplicitStatus } = require('./status-guard');

// --scenario (#275): the file is loaded and hashed, and what the run has
// recorded so far is cross-checked against it. Resolved against the caller's
// cwd, as handleScreenshot resolves its path; buildExecutor decides how it is
// recorded. Returns null without --scenario, `{ failure }` when it is refused,
// else `{ file, sha256, scenario, recorded }`.
function loadScenarioContext({ validator, resultStoreFactory, projectRoot, cwd }, { runId, scenarioId, scenario }) {
  if (scenario === undefined) return null;
  const file = path.resolve(cwd, scenario);
  const loaded = loadScenario(validator, file, { strict: false });
  if (loaded.failure) return { failure: loaded.failure };
  const recorded = resultStoreFactory({ runId, scenarioId, projectRoot }).recorded();
  const mismatch = scenarioMismatch(recorded, loaded);
  if (mismatch) {
    return {
      failure: { envelope: fail('invalid_input', mismatch.message, mismatch.hint, mismatch.data), exitKind: 'invalid_input' },
    };
  }
  return { file, sha256: loaded.sha256, scenario: loaded.scenario, recorded };
}

function finalizeAgainstScenario(
  { validator, resultStoreFactory, memoryStoreFactory, projectRoot, cwd = process.cwd(), finalizeRun },
  opts
) {
  const { runId, scenarioId, status, duration } = opts;

  // Both refusals below read a snapshot taken before the store's lock; they
  // only ever refuse and never write, so the written status stays decided
  // under the lock (ResultStore#finalize).
  const context = loadScenarioContext({ validator, resultStoreFactory, projectRoot, cwd }, opts);
  if (context && context.failure) return context.failure;

  // An explicit --status may equal the derived one or make the run worse,
  // never greener (src/result/status-guard.js). Refused before anything is
  // written.
  if (status !== undefined) {
    const { steps, assertions } = context ? context.recorded : resultStoreFactory({ runId, scenarioId, projectRoot }).recorded();
    const refusal = checkExplicitStatus({
      status,
      steps,
      assertions,
      scenarioAssertionCount: context ? (context.scenario.assertions || []).length : undefined,
      unrecorded: context ? unrecordedEntries(context.recorded, context.scenario) : null,
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
      executor: buildExecutor({
        kind: 'agent',
        projectRoot,
        scenarioPath: context ? context.file : null,
        scenarioSha256: context ? context.sha256 : null,
      }),
      // With it, the store derives a run that never recorded a declared step
      // or assertion `incomplete`, deciding under its lock (#335).
      scenario: context ? context.scenario : undefined,
    }
  );

  // Exit 7: nothing failed, but an agent still has to judge something. The
  // file is written; the hint is the exact commands that complete it.
  // `data.unrecorded` (#335) is what the scenario declares and the written
  // result never recorded, read from that result itself; it sits beside the
  // result fields, never in the file. Only an incomplete run reports it: a
  // failed or errored run is decided, and its later steps legitimately never
  // ran.
  if (result.status === 'incomplete') {
    const unrecorded = context
      ? unrecordedEntries({ steps: result.steps_executed, assertions: result.assertion_results }, context.scenario)
      : null;
    const data = hasUnrecorded(unrecorded) ? { ...result, unrecorded } : result;
    return {
      envelope: incompleteEnvelope(result, { hints, projectRoot, data, unrecorded }),
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
