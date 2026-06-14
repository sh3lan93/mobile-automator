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

    const loaded = this._load();
    this._steps = loaded.steps_executed || [];
    this._assertions = loaded.assertion_results || [];
    this._observations = loaded.observations || [];
    this._capturedVariables = loaded.captured_variables || {};
    if (!this.scenarioId && loaded.scenario_id) this.scenarioId = loaded.scenario_id;
  }

  // Load an existing in-progress (or finalized) file if present; else empty.
  _load() {
    try {
      const raw = fs.readFileSync(this._file, 'utf8');
      return JSON.parse(raw);
    } catch (_e) {
      return {};
    }
  }

  _persistInProgress() {
    fs.mkdirSync(this._dir, { recursive: true });
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
    fs.writeFileSync(this._file, JSON.stringify(snapshot, null, 2));
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

    fs.mkdirSync(this._dir, { recursive: true });
    fs.writeFileSync(this._file, JSON.stringify(result, null, 2));
    return result;
  }
}

module.exports = { ResultStore };
