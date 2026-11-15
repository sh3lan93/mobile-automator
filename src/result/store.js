'use strict';

const fs = require('fs');
const path = require('path');

const { atomicWrite } = require('../util/atomic');
const { withLock } = require('../util/lock');
const { OBSERVATION_TYPES, stepStatus } = require('./flags');
const {
  deriveRunStatus,
  isErroredStep,
  isFailedStep,
  isFailingAssertion,
  isPendingAssertion,
  isPendingStep,
} = require('./outcome');
const { workspaceDir } = require('../workspace/layout');

// Incremental result accumulator that persists to
//   <projectRoot>/.mobile-automator/results/<runId>.json
//
// The CLI runs one-shot: each `result add-step` / `result finalize` invocation
// is a fresh process. To support that, the store loads any existing in-progress
// file for the run on construction and appends to it, so state survives across
// invocations until finalize writes the schema-conformant result.

const SCHEMA_VERSION = '2.0';

// The one place that knows where a run's result file lives.
function resultsDir(projectRoot) {
  return path.join(workspaceDir(projectRoot), 'results');
}

function resultFile(projectRoot, runId) {
  return path.join(resultsDir(projectRoot), `${runId}.json`);
}

// A crash report is read into an agent's context and routinely committed to a
// repo. A native tombstone is tens of kilobytes, so the excerpt is bounded HERE
// rather than trusted from the caller — the full report's home is report_path.
const MAX_CRASH_EXCERPT = 2000;

function defaultMetadata(overrides = {}) {
  return {
    app_version: overrides.app_version || 'unknown',
    device_model: overrides.device_model || 'unknown',
    api_level: overrides.api_level || 'unknown',
    environment: overrides.environment || 'unknown',
    timestamp: overrides.timestamp || new Date().toISOString(),
  };
}

// The default summary's tail naming the failing steps, so a run a step turned
// red does not read `failed: 0/0 assertion(s) passed` with no reason (#296).
// Empty when no step failed, which keeps the pre-#296 text for those runs.
function stepFailureSuffix(steps) {
  const failed = steps.filter(isFailedStep).length;
  const errored = steps.filter(isErroredStep).length;
  return `${failed ? `, ${failed} failed` : ''}${errored ? `, ${errored} errored` : ''}`;
}

// The summary tail counting entries still waiting for an agent (#275); empty
// when there are none, which keeps the text every earlier run had.
function pendingSuffix(steps, assertions) {
  const pending = steps.filter(isPendingStep).length + assertions.filter(isPendingAssertion).length;
  return pending ? `, ${pending} pending agent judgment` : '';
}

const ASSERTION_STATUSES = ['passed', 'failed', 'needs_agent'];

// The status to record. `status` is the explicit form (#275, B3). The legacy
// boolean `pass` of callers that predate it is still accepted, so they write
// byte-identical result files; anything else (including the retired
// `pass: 'pending'`) is a caller bug and throws rather than guessing.
function assertionStatus({ status, pass }) {
  if (status !== undefined) {
    if (!ASSERTION_STATUSES.includes(status)) {
      throw new Error(`unknown assertion status "${status}" (expected ${ASSERTION_STATUSES.join(' | ')})`);
    }
    return status;
  }
  if (typeof pass !== 'boolean') {
    throw new Error(`addAssertion needs a status (${ASSERTION_STATUSES.join(' | ')}) or a boolean legacy pass (pass must be a boolean)`);
  }
  return pass ? 'passed' : 'failed';
}

// The executor a finalize writes (#275, plan decision 4): the first one is
// kept, so an agent completing a runner's run never rewrites it as its own.
// The one thing a later finalize may add is the scenario, when the first was
// written without one; the CLI refuses a scenario that differs from a
// recorded hash before it gets here.
function mergeExecutor(existing, incoming) {
  if (!existing) return incoming || null;
  if (incoming && existing.scenario_sha256 == null && incoming.scenario_sha256 != null) {
    return { ...existing, scenario_path: incoming.scenario_path, scenario_sha256: incoming.scenario_sha256 };
  }
  return existing;
}

class ResultStore {
  constructor({ runId, scenarioId, projectRoot, metadata } = {}) {
    if (!projectRoot) throw new Error('ResultStore requires a projectRoot');
    // The one gate for every writer (#295): the id becomes `<runId>.json` and
    // `<runId>.lock` below, and atomicWrite creates parent directories, so an
    // id with a separator would write outside results/. Same rule as the
    // reader, readFinalizedResult, so the two cannot disagree on valid ids.
    // Thrown before anything is read or written; the CLI's toEnvelope maps it
    // to invalid_input (exit 3).
    if (!isResultRunId(runId)) throw new InvalidRunIdError(projectRoot, runId);

    this.runId = runId;
    this.scenarioId = scenarioId || null;
    this.projectRoot = projectRoot;
    this._metadataOverrides = metadata || {};

    this._dir = resultsDir(projectRoot);
    this._file = resultFile(projectRoot, runId);
    // Per-runId advisory lock guarding every read-modify-write mutator. Lives
    // in the same directory as the result file, so the lock is scoped to this
    // run only — different runs never contend on it.
    this._lock = path.join(this._dir, `${runId}.lock`);

    // Honest-corruption channel: any recovery the load performs is recorded
    // here so the CLI can thread it into the envelope `hint`. Must exist
    // before `_load()` runs.
    this.warnings = [];

    this._refreshFromDisk();
  }

  // The result file this store reads and writes. Read-only: the store owns the
  // location, so callers name the file through it rather than rebuilding it.
  get file() {
    return this._file;
  }

  // Re-load the on-disk accumulator and refresh the in-memory fields. The
  // constructor eager-loads once (read-only paths and back-compat), but every
  // persisting mutator re-runs this UNDER the per-runId lock so it operates on
  // fresh-from-disk state — never the possibly-stale constructor snapshot.
  // Without this, two concurrent processes would both cache the same stale
  // snapshot and serialize only their writes, so the last rename would win and
  // the other's mutation would be silently lost.
  _refreshFromDisk() {
    const loaded = this._load();
    this._steps = loaded.steps_executed || [];
    this._assertions = loaded.assertion_results || [];
    this._observations = loaded.observations || [];
    this._capturedVariables = loaded.captured_variables || {};
    this._crashes = loaded.crashes || [];
    this._executor = loaded.executor || null;
    if (!this.scenarioId && loaded.scenario_id) this.scenarioId = loaded.scenario_id;
  }

  // Load an existing in-progress (or finalized) file if present; else empty.
  //
  // A missing file (ENOENT) is the legitimate first step → empty accumulator.
  // A file that exists but does not parse is a crash artifact: we MUST NOT
  // silently treat it as empty (that would let the next write O_TRUNC-clobber
  // every previously recorded step). Instead we preserve the bytes as a
  // `.corrupt.<ts>` sidecar, record a structured warning (surfaced via the
  // envelope `hint`), and start a fresh accumulator.
  _load() {
    let raw;
    try {
      raw = fs.readFileSync(this._file, 'utf8');
    } catch (e) {
      if (e && e.code === 'ENOENT') return {};
      // Unexpected read failure (perms, I/O) — surface it honestly rather
      // than masquerading as an empty run.
      throw e;
    }
    try {
      return JSON.parse(raw);
    } catch (e) {
      return this._preserveCorrupt(raw, e);
    }
  }

  // Move a corrupt result file aside so its bytes are never lost, record a
  // structured warning, and return an empty accumulator. The warning is the
  // single source of truth for the recovery — the CLI threads `store.warnings`
  // into the envelope `hint` (machine) which `render({human:true})` also shows
  // (human), so the model stays print-free and trivially unit-testable. Sidecar
  // write failures are themselves surfaced as warnings rather than aborting.
  _preserveCorrupt(raw, err) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const sidecar = `${this._file}.corrupt.${ts}`;
    let preserved = false;
    try {
      fs.renameSync(this._file, sidecar);
      preserved = true;
    } catch (_renameErr) {
      // Cross-device or other rename failure — fall back to a copy.
      try {
        fs.writeFileSync(sidecar, raw);
        preserved = true;
      } catch (_writeErr) {
        // ignore — reported below
      }
    }
    const where = preserved ? `preserved as ${path.basename(sidecar)}` : 'COULD NOT be preserved';
    const message =
      `result file ${this._file} was corrupt (${err.message}); ` +
      `${where} and a fresh accumulator was started so prior steps are not silently clobbered`;
    this.warnings.push(message);
    return {};
  }

  // Atomic write: delegates to the shared util (see src/util/atomic.js).
  // `this._dir === path.dirname(this._file)` (results dir), so this is
  // behavior-identical to the previous inline implementation.
  _atomicWrite(contents) {
    atomicWrite(this._file, contents);
  }

  // The in-progress marker below is private to this module; readers ask
  // isInProgress() instead of keying on the field themselves.
  _persistInProgress() {
    const snapshot = {
      run_id: this.runId,
      scenario_id: this.scenarioId,
      schema_version: SCHEMA_VERSION,
      steps_executed: this._steps,
      assertion_results: this._assertions,
      observations: this._observations,
      captured_variables: this._capturedVariables,
      crashes: this._crashes,
      _in_progress: true,
    };
    // A re-opened finalized run (an agent deciding its pending assertions)
    // must not lose who produced it.
    if (this._executor) snapshot.executor = this._executor;
    this._atomicWrite(JSON.stringify(snapshot, null, 2));
  }

  // What the run has recorded so far, for checking it against a scenario
  // (src/result/scenario-check.js crossCheck). A deep copy: the caller reads it,
  // it never writes through it.
  recorded() {
    return structuredClone({
      scenario_id: this.scenarioId,
      steps: this._steps,
      assertions: this._assertions,
      executor: this._executor,
    });
  }

  addStep({ step_id, status, attempts = 1, screenshot = null, error_message = null, observations = null, needs_agent = false,
    condition_evaluated, step_duration_ms, sub_steps_executed } = {}) {
    return withLock(this._lock, () => {
      this._refreshFromDisk();
      const normalized = stepStatus(status);
      const retryCount = Math.max(0, Number(attempts) - 1);
      const step = {
        step_id,
        status: normalized,
        screenshot,
        error_message,
        retried: retryCount > 0,
        retry_count: retryCount,
        observations,
        // Only a step an agent must do carries the flag (see isPendingStep).
        ...(needs_agent === true ? { needs_agent: true } : {}),
        // Control-flow facts (#280): written only by `mauto run`, so a step
        // recorded through the verbs carries none of them.
        ...(condition_evaluated !== undefined ? { condition_evaluated } : {}),
        ...(step_duration_ms !== undefined ? { step_duration_ms } : {}),
        ...(Array.isArray(sub_steps_executed) ? { sub_steps_executed } : {}),
      };
      this._steps.push(step);

      // Flakiness bookkeeping: a step that ultimately PASSED but needed more than
      // one attempt is flaky.
      if (retryCount > 0 && normalized === 'passed') {
        this._observations.push({
          type: 'flakiness',
          step_id,
          message: `Step '${step_id}' passed only after ${attempts} attempts; possible flakiness.`,
        });
      }

      this._persistInProgress();
      return step;
    });
  }

  // Append a TYPED observation to the run-level `observations` array — the one
  // `finalize()` emits and `src/memory/store.js` harvests. Deliberately NOT
  // routed through `addStep`: the step-level `observations` field is a legacy
  // freeform string, so writing there would produce untyped text in the wrong
  // shape (see #140 D2).
  addObservation({ type, step_id = null, message } = {}) {
    return withLock(this._lock, () => {
      this._refreshFromDisk();
      if (!OBSERVATION_TYPES.includes(type)) {
        throw new Error(
          `unknown observation type "${type}" (expected ${OBSERVATION_TYPES.join(' | ')})`
        );
      }
      if (message == null || String(message).trim() === '') {
        throw new Error(
          'observation message is required and cannot be empty or whitespace-only'
        );
      }
      const entry = { type, step_id: step_id == null ? null : String(step_id), message: String(message) };
      this._observations.push(entry);
      this._persistInProgress();
      return entry;
    });
  }

  // Record an assertion verdict. `status` is passed | failed | needs_agent
  // (#275); the legacy boolean `pass` is still accepted in its place. Provenance is persisted beside it: `type`,
  // `step_id`, `mechanical` (as given by the caller) and `judge`
  // (omitted unless given — a caller that does not say who decided records
  // no claim).
  //
  // With an explicit assertion_id, a verdict REPLACES a `needs_agent` entry of
  // that id in place, keeping its position, and a pending verdict for an id
  // already decided throws AlreadyDecidedError: a run never goes from decided
  // back to undecided. A derived id (none given) always appends, as do two
  // decided verdicts for one id.
  addAssertion({
    step_id, assertion_id, type, status, pass, message, expected = null, actual = null, mechanical, judge,
  } = {}) {
    return withLock(this._lock, () => {
      this._refreshFromDisk();
      const entry = {
        assertion_id: assertion_id || `${step_id || 'assert'}_${type || 'unknown'}_${this._assertions.length + 1}`,
        status: assertionStatus({ status, pass }),
        expected: expected == null ? null : String(expected),
        actual: actual == null ? null : String(actual),
        message: message || '',
      };
      if (typeof type === 'string') entry.type = type;
      if (step_id != null) entry.step_id = String(step_id);
      // Supplied by the caller, which knows whether its verdict came from the
      // CLI's evaluator; the store only records it.
      if (mechanical !== undefined) entry.mechanical = mechanical;
      if (judge != null) entry.judge = judge;

      const sameId = (a) => Boolean(assertion_id) && a !== null && typeof a === 'object' && a.assertion_id === assertion_id;
      if (isPendingAssertion(entry)) {
        const decided = this._assertions.find((a) => sameId(a) && !isPendingAssertion(a));
        if (decided) throw new AlreadyDecidedError(assertion_id, decided.status);
      }
      const pendingIndex = this._assertions.findIndex((a) => sameId(a) && isPendingAssertion(a));
      if (pendingIndex === -1) this._assertions.push(entry);
      else this._assertions[pendingIndex] = entry;
      this._persistInProgress();
      return entry;
    });
  }

  addCrash({ crash_id, process = null, timestamp = null, step_id = null, excerpt = null, report_path = null } = {}) {
    return withLock(this._lock, () => {
      this._refreshFromDisk();
      if (!crash_id || String(crash_id).trim() === '') {
        // Without an id the full report is unreachable, which makes the record
        // a claim nobody can check.
        throw new Error('addCrash requires a crash_id');
      }
      const entry = {
        crash_id: String(crash_id),
        process: process == null ? null : String(process),
        timestamp: timestamp == null ? null : String(timestamp),
        detected_at: new Date().toISOString(),
        step_id: step_id == null ? null : String(step_id),
        excerpt: excerpt == null ? null : String(excerpt).slice(0, MAX_CRASH_EXCERPT),
        report_path: report_path == null ? null : String(report_path),
      };
      this._crashes.push(entry);
      this._persistInProgress();
      return entry;
    });
  }

  captureVariable(name, value) {
    return withLock(this._lock, () => {
      this._refreshFromDisk();
      this._capturedVariables[name] = value;
      this._persistInProgress();
    });
  }

  // Typed observations derived from the measurement.
  //
  // They go in the observations array as well as in `measurements` because
  // src/memory/store.js harvests observations into run-history: a scenario
  // whose reported durations are chronically wrong, or whose steps claim no
  // retries while the device kept failing, is a CROSS-RUN fact, and
  // `measurements` is only ever read one file at a time.
  //
  // `state_context` for the duration case rather than a new observation type:
  // extending the enum would mean changing OBSERVATION_TYPES and the schema
  // together for a fact the existing vocabulary already describes — the agent's
  // model of the run disagreed with the machine's.
  _measurementObservations(measurements, measuredSeconds) {
    const notes = [];
    if (!measurements) return notes;

    if (measurements.duration_disagreement) {
      notes.push({
        type: 'state_context',
        step_id: null,
        message:
          `Reported duration ${measurements.reported_duration_seconds}s disagrees with ` +
          `${measuredSeconds}s measured from the run trace; the measured value was recorded.`,
      });
    }

    // Provable under-report: the device failed, and not one step admits to a
    // retry. `_steps.length > 0` because `every` on an empty array is true, and
    // a run with no steps has nothing to under-report.
    if (
      measurements.device_failures > 0 &&
      this._steps.length > 0 &&
      this._steps.every((s) => (s.retry_count || 0) === 0)
    ) {
      notes.push({
        type: 'flakiness',
        step_id: null,
        message:
          `${measurements.device_failures} device call(s) failed during this run, but no step ` +
          `reported a retry; the recorded attempt counts under-report what the device saw.`,
      });
    }

    return notes;
  }

  finalize({ status, durationSeconds = 0, summary, metadata, measurements, executor } = {}) {
    return withLock(this._lock, () => {
      this._refreshFromDisk();

      // Appended INSIDE the lock and deduped by (type, message), so re-running
      // finalize — which the execute guide tells an agent to do after a failed
      // one — cannot stack duplicates.
      for (const note of this._measurementObservations(measurements, Number(durationSeconds) || 0)) {
        const already = this._observations.some(
          (o) => o.type === note.type && o.message === note.message
        );
        if (!already) this._observations.push(note);
      }

      const passed = this._assertions.filter((a) => a.status === 'passed').length;
      const failed = this._assertions.filter(isFailingAssertion).length;
      const total = this._assertions.length;

      const resolvedStatus = status || deriveRunStatus(this._steps, this._assertions);

      const result = {
        run_id: this.runId,
        scenario_id: this.scenarioId,
        schema_version: SCHEMA_VERSION,
        status: resolvedStatus,
        metadata: defaultMetadata({ ...this._metadataOverrides, ...(metadata || {}) }),
        total_assertions: total,
        passed_assertions: passed,
        failed_assertions: failed,
        duration_seconds: Number(durationSeconds) || 0,
        steps_executed: this._steps,
        assertion_results: this._assertions,
        observations: this._observations,
        captured_variables: this._capturedVariables,
        summary:
          summary ||
          `${resolvedStatus}: ${passed}/${total} assertion(s) passed across ${this._steps.length} step(s)` +
            `${stepFailureSuffix(this._steps)}${pendingSuffix(this._steps, this._assertions)}.`,
      };

      // Who produced the result and from what (#275). Absent only when no
      // finalize has ever been told, so a store driven without one writes the
      // file it always wrote.
      this._executor = mergeExecutor(this._executor, executor);
      if (this._executor) result.executor = this._executor;

      // Additive and OMITTED when absent: a result file from a run with no
      // trace must stay shaped exactly as 0.24.0 wrote it, so finalize never
      // emits an empty measurements object as a placeholder.
      if (measurements) result.measurements = measurements;

      // Present only when non-empty. That is what makes `crashes` additive in
      // PRACTICE and not merely in schema: a run with no crashes emits exactly
      // the file it emitted before this field existed.
      if (this._crashes.length > 0) result.crashes = this._crashes;

      this._atomicWrite(JSON.stringify(result, null, 2));
      return result;
    });
  }
}

function isInProgress(parsed) {
  return Boolean(parsed && parsed._in_progress);
}

// A run id names a file in results/ — `<runId>.json` — so it must be a single
// path segment: a non-empty string with no separator and no NUL. `.` and `..`
// pass, harmlessly: the appended `.json` keeps them inside results/. This is
// deliberately NOT the result schema's run_id pattern nor observe/paths.js's
// isValidRunId: it is the one rule shared by the writers (the ResultStore
// constructor and the `result` write verbs, #295) and the reader
// (readFinalizedResult), so an id finalize accepted is always exportable.
function isResultRunId(runId) {
  return (
    typeof runId === 'string' &&
    runId.length > 0 &&
    !runId.includes('\0') &&
    path.basename(runId) === runId
  );
}

// Typed error for a run id isResultRunId refuses, carrying the envelope's kind
// and hint (the DeviceResolutionError pattern). Thrown by the ResultStore
// constructor, returned as data by readFinalizedResult — one wording for both.
class InvalidRunIdError extends Error {
  constructor(projectRoot, runId) {
    super(`invalid run id "${runId}"`);
    this.name = 'InvalidRunIdError';
    this.kind = 'invalid_input';
    this.hint = `A run id names a file in ${resultsDir(projectRoot)}; it cannot contain a path separator.`;
  }
}

// Typed error for `pending` recorded over an assertion already decided (#275):
// a decided verdict is never turned back into an undecided one. Carries the
// envelope's kind and hint, like InvalidRunIdError.
class AlreadyDecidedError extends Error {
  constructor(assertionId, status) {
    super(`assertion "${assertionId}" is already decided (${status}); it cannot go back to pending`);
    this.name = 'AlreadyDecidedError';
    this.kind = 'invalid_input';
    this.hint =
      `Record a verdict for "${assertionId}" with --pass true|false, or use a different --assertion-id ` +
      'for a new pending assertion.';
  }
}

// Read a finalized result file for a report, WITHOUT going through the
// ResultStore constructor: that constructor renames a corrupt file aside as a
// `.corrupt.<ts>` sidecar, and a reader must never mutate the workspace it
// reads. This function performs no writes, renames or locks.
//
// "Finalized" is defined by its writer, `ResultStore#finalize` above: a JSON
// object with no `_in_progress` marker whose run_id is the requested id. The
// reader checks exactly that and nothing more — it does not hold files to the
// result schema, because finalize itself does not (a run recorded without
// --scenario-id is written with scenario_id null, and pre-0.38.0 files carry
// an upper-case status). Consumers tolerate shape beyond that object.
//
// Returns `{ result }` or `{ error: { kind, message, hint } }` where kind is
// `invalid_input` (bad id, no file, not JSON, in progress, not a finalized
// result) or `environment` (the file exists but could not be read).
function readFinalizedResult(projectRoot, runId) {
  const invalid = (message, hint) => ({ error: { kind: 'invalid_input', message, hint } });
  if (!isResultRunId(runId)) {
    const { kind, message, hint } = new InvalidRunIdError(projectRoot, runId);
    return { error: { kind, message, hint } };
  }
  const file = resultFile(projectRoot, runId);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return invalid(
        `no result file for ${runId}`,
        `Expected ${file}; list the run ids with \`ls ${resultsDir(projectRoot)}\`.`
      );
    }
    return { error: { kind: 'environment', message: `could not read ${file}: ${err.message}`, hint: null } };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return invalid(`result file for ${runId} is not valid JSON (${err.message})`, `Inspect ${file}.`);
  }
  const notAResult = (reason) =>
    invalid(
      `result file for ${runId} is not a finalized result: ${reason}`,
      `Inspect ${file}; result files are written by \`mauto result finalize\`.`
    );
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return notAResult('(root) must be object');
  }
  if (isInProgress(parsed)) {
    return invalid(`run ${runId} is not finalized`, `Run \`mauto result finalize --run-id ${runId}\` first.`);
  }
  if (parsed.run_id !== runId) return notAResult(`its run_id is ${JSON.stringify(parsed.run_id)}`);
  return { result: parsed };
}

module.exports = {
  ResultStore,
  readFinalizedResult,
  resultFile,
  isResultRunId,
  InvalidRunIdError,
  AlreadyDecidedError,
};
