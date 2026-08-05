'use strict';

// Single source of truth binding every FACT a result file can carry to the
// three things that must agree and never drift: the result schema (does the
// file have a home for it), the ResultStore (does a method write it), and the
// `mauto result` verb surface (can an agent actually supply it).
//
// tests/lint/result-coverage.test.js derives its assertions from this map, so
// a capability that loses its CLI reach fails the build instead of silently
// producing an empty field — which is exactly how #140 went unnoticed. This
// mirrors src/device/action-catalog.js, whose guard (#117) covers device
// ACTIONS and has no jurisdiction over the result verbs.
//
// `writeCheck` declares how the guard proves the ResultStore method actually
// writes the field, because a plain `store.js.includes(writes)` check is only
// trustworthy when `writes` names a token unique to that write site:
//   'substring'  — `writes` is a call/assignment-shaped token (e.g.
//                  `this._assertions.push(entry)`) that occurs nowhere else in
//                  store.js, so deleting the real write makes it disappear.
//   'behavioral' — the field is a bare scalar (e.g. `screenshot`) that also
//                  appears as a destructured parameter name or elsewhere in
//                  store.js, so no substring can distinguish "written" from
//                  "merely accepted". These are instead proven by a live
//                  ResultStore run in tests/lint/result-coverage.test.js.
const RESULT_CAPABILITIES = {
  screenshot: {
    verb: 'add-step',
    flags: ['--screenshot'],
    store: 'addStep',
    writes: 'screenshot',
    writeCheck: 'behavioral',
    schemaPointer: '/properties/steps_executed/items/properties/screenshot',
  },
  error_message: {
    verb: 'add-step',
    flags: ['--error-message'],
    store: 'addStep',
    writes: 'error_message',
    writeCheck: 'behavioral',
    schemaPointer: '/properties/steps_executed/items/properties/error_message',
  },
  step_status: {
    verb: 'add-step',
    flags: ['--status'],
    store: 'addStep',
    writes: 'status: normalized',
    writeCheck: 'substring',
    schemaPointer: '/properties/steps_executed/items/properties/status',
  },
  flakiness_observation: {
    verb: 'add-step',
    flags: ['--attempts'],
    store: 'addStep',
    // `--attempts` carries no field of its own; it drives the retry-derived
    // flakiness observation store.js pushes onto the run-level `observations`
    // array (see ResultStore#addStep), so it is bound to that schema node.
    writes: "type: 'flakiness'",
    writeCheck: 'substring',
    schemaPointer: '/properties/observations',
  },
  observation: {
    verb: 'add-step',
    flags: ['--observation'],
    store: 'addObservation',
    writes: 'this._observations.push(entry)',
    writeCheck: 'substring',
    schemaPointer: '/properties/observations',
  },
  captured_variable: {
    verb: 'add-step',
    flags: ['--capture'],
    store: 'captureVariable',
    writes: 'this._capturedVariables[name] = value',
    writeCheck: 'substring',
    schemaPointer: '/properties/captured_variables',
  },
  assertion_verdict: {
    verb: 'add-assertion',
    flags: ['--type', '--pass', '--assertion-id', '--message', '--expected', '--actual'],
    store: 'addAssertion',
    writes: 'this._assertions.push(entry)',
    writeCheck: 'substring',
    schemaPointer: '/properties/assertion_results',
  },
  run_status: {
    verb: 'finalize',
    flags: ['--status'],
    store: 'finalize',
    writes: 'status: resolvedStatus',
    writeCheck: 'substring',
    schemaPointer: '/properties/status',
  },
  duration: {
    verb: 'finalize',
    flags: ['--duration'],
    store: 'finalize',
    writes: 'duration_seconds: Number(durationSeconds) || 0',
    writeCheck: 'substring',
    schemaPointer: '/properties/duration_seconds',
  },
  run_metadata: {
    verb: 'finalize',
    flags: ['--app-version', '--device-model', '--api-level', '--environment'],
    store: 'finalize',
    writes: 'metadata',
    writeCheck: 'behavioral',
    schemaPointer: '/properties/metadata',
  },
  summary: {
    verb: 'finalize',
    flags: ['--summary'],
    store: 'finalize',
    writes: 'summary',
    writeCheck: 'behavioral',
    schemaPointer: '/properties/summary',
  },
};

// Flags that identify WHICH run/step is being recorded, rather than carrying
// a result fact of their own. Excluded from the no-orphan check. `--status`,
// `--duration` and `--attempts` are deliberately NOT here — each carries a
// fact of its own (step/run verdict, run duration, retry-derived flakiness)
// and has its own RESULT_CAPABILITIES entry above.
const IDENTITY_FLAGS = new Set([
  '--run-id',
  '--scenario-id',
  '--step-id',
]);

// Top-level result-schema properties that legitimately have no capability
// entry: no `mauto result` flag should ever set them directly. Each entry
// names why, so growing this list always carries its own justification
// instead of becoming a silent escape hatch from the completeness guard in
// tests/lint/result-coverage.test.js.
const NO_FLAG_ALLOWLIST = {
  run_id: 'supplied via the --run-id identity flag on every result verb, not a capability-carried fact',
  scenario_id: 'supplied via the --scenario-id identity flag, not a capability-carried fact',
  schema_version: 'constant emitted by ResultStore (SCHEMA_VERSION); never agent-supplied',
  total_assertions: 'derived by ResultStore.finalize by counting assertion_results; no independent flag by design',
  passed_assertions: 'derived by ResultStore.finalize by counting assertion_results; no independent flag by design',
  failed_assertions: 'derived by ResultStore.finalize by counting assertion_results; no independent flag by design',
};

module.exports = { RESULT_CAPABILITIES, IDENTITY_FLAGS, NO_FLAG_ALLOWLIST };
