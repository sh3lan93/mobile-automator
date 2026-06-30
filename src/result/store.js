'use strict';

const fs = require('fs');
const path = require('path');

// Incremental result accumulator that persists to
//   <projectRoot>/mobile-automator/results/<runId>.json
//
// The CLI runs one-shot: each `result add-step` / `result finalize` invocation
// is a fresh process. To support that, the store loads any existing in-progress
// file for the run on construction and appends to it, so state survives across
// invocations until finalize writes the schema-conformant result.

const SCHEMA_VERSION = '2.0';

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

    // Honest-corruption channel: any recovery the load performs is recorded
    // here so the CLI can thread it into the envelope `hint`. Must exist
    // before `_load()` runs.
    this.warnings = [];

    const loaded = this._load();
    this._steps = loaded.steps_executed || [];
    this._assertions = loaded.assertion_results || [];
    this._observations = loaded.observations || [];
    this._capturedVariables = loaded.captured_variables || {};
    if (!this.scenarioId && loaded.scenario_id) this.scenarioId = loaded.scenario_id;
  }

  // Load an existing in-progress (or finalized) file if present; else empty.
  //
  // A missing file (ENOENT) is the legitimate first step → empty accumulator.
  // A file that exists but does not parse is a crash artifact: we MUST NOT
  // silently treat it as empty (that would let the next write O_TRUNC-clobber
  // every previously recorded step). Instead we preserve the bytes as a
  // `.corrupt.<ts>` sidecar, record a warning (stderr + envelope hint), and
  // start a fresh accumulator.
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

  // Move a corrupt result file aside so its bytes are never lost, warn loudly,
  // and return an empty accumulator. Failures to write the sidecar are
  // themselves surfaced as warnings rather than aborting the run.
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
    // eslint-disable-next-line no-console
    console.warn(`[mauto] ${message}`);
    return {};
  }

  // Atomic write: stream into a hidden temp file in the same directory,
  // fsync, then rename over the target. rename(2) within one dir is atomic, so
  // a concurrent reader or a crash sees the old-complete or new-complete file,
  // never a truncated one. On any failure the temp file is cleaned up.
  _atomicWrite(contents) {
    fs.mkdirSync(this._dir, { recursive: true });
    const tmp = path.join(
      this._dir,
      `.${path.basename(this._file)}.tmp.${process.pid}.${Date.now()}`
    );
    let fd;
    try {
      fd = fs.openSync(tmp, 'w');
      fs.writeFileSync(fd, contents);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(tmp, this._file);
    } catch (e) {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch (_) {
          /* ignore */
        }
      }
      try {
        fs.unlinkSync(tmp);
      } catch (_) {
        /* ignore */
      }
      throw e;
    }
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
      _in_progress: true,
    };
    this._atomicWrite(JSON.stringify(snapshot, null, 2));
  }

  addStep({ step_id, status, attempts = 1, screenshot = null, error_message = null, observations = null } = {}) {
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
  }

  addAssertion({ step_id, assertion_id, type, pass, message, expected = null, actual = null } = {}) {
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
  }

  captureVariable(name, value) {
    this._capturedVariables[name] = value;
    this._persistInProgress();
  }

  finalize({ status, durationSeconds = 0, summary, metadata } = {}) {
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

    this._atomicWrite(JSON.stringify(result, null, 2));
    return result;
  }
}

module.exports = { ResultStore };
