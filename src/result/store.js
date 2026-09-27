'use strict';

const fs = require('fs');
const path = require('path');

const { atomicWrite } = require('../util/atomic');
const { withLock } = require('../util/lock');
const { OBSERVATION_TYPES } = require('./flags');

// Incremental result accumulator that persists to
//   <projectRoot>/mobile-automator/results/<runId>.json
//
// The CLI runs one-shot: each `result add-step` / `result finalize` invocation
// is a fresh process. To support that, the store loads any existing in-progress
// file for the run on construction and appends to it, so state survives across
// invocations until finalize writes the schema-conformant result.

const SCHEMA_VERSION = '2.0';

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

// Normalize the caller-friendly status ('pass'/'fail') to the schema enums.
function stepStatus(status) {
  if (status === 'pass' || status === 'passed') return 'passed';
  if (status === 'fail' || status === 'failed') return 'failed';
  if (status === 'skipped' || status === 'skip') return 'skipped';
  return 'error';
}

function assertionStatus(pass) {
  return pass ? 'passed' : 'failed';
}

class ResultStore {
  constructor({ runId, scenarioId, projectRoot, metadata } = {}) {
    if (!runId) throw new Error('ResultStore requires a runId');
    if (!projectRoot) throw new Error('ResultStore requires a projectRoot');

    this.runId = runId;
    this.scenarioId = scenarioId || null;
    this.projectRoot = projectRoot;
    this._metadataOverrides = metadata || {};

    this._dir = path.join(projectRoot, 'mobile-automator', 'results');
    this._file = path.join(this._dir, `${runId}.json`);
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
    this._atomicWrite(JSON.stringify(snapshot, null, 2));
  }

  addStep({ step_id, status, attempts = 1, screenshot = null, error_message = null, observations = null } = {}) {
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

  addAssertion({ step_id, assertion_id, type, pass, message, expected = null, actual = null } = {}) {
    return withLock(this._lock, () => {
      this._refreshFromDisk();
      const entry = {
        assertion_id: assertion_id || `${step_id || 'assert'}_${type || 'unknown'}_${this._assertions.length + 1}`,
        status: assertionStatus(pass),
        expected: expected == null ? null : String(expected),
        actual: actual == null ? null : String(actual),
        message: message || '',
      };
      this._assertions.push(entry);
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

  finalize({ status, durationSeconds = 0, summary, metadata, measurements } = {}) {
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
      const failed = this._assertions.filter((a) => a.status === 'failed').length;
      const total = this._assertions.length;

      const resolvedStatus = status || (failed > 0 ? 'failed' : 'passed');

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
          `${resolvedStatus}: ${passed}/${total} assertion(s) passed across ${this._steps.length} step(s).`,
      };

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

module.exports = { ResultStore };
