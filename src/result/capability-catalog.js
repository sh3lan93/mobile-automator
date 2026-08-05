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
const RESULT_CAPABILITIES = {
  screenshot: {
    verb: 'add-step',
    flags: ['--screenshot'],
    store: 'addStep',
    writes: 'screenshot',
    schemaPointer: '/properties/steps_executed/items/properties/screenshot',
  },
  error_message: {
    verb: 'add-step',
    flags: ['--error-message'],
    store: 'addStep',
    writes: 'error_message',
    schemaPointer: '/properties/steps_executed/items/properties/error_message',
  },
  observation: {
    verb: 'add-step',
    flags: ['--observation'],
    store: 'addObservation',
    writes: '_observations',
    schemaPointer: '/properties/observations',
  },
  captured_variable: {
    verb: 'add-step',
    flags: ['--capture'],
    store: 'captureVariable',
    writes: '_capturedVariables',
    schemaPointer: '/properties/captured_variables',
  },
  assertion_verdict: {
    verb: 'add-assertion',
    flags: ['--type', '--pass', '--assertion-id', '--message', '--expected', '--actual'],
    store: 'addAssertion',
    writes: '_assertions',
    schemaPointer: '/properties/assertion_results',
  },
  run_metadata: {
    verb: 'finalize',
    flags: ['--app-version', '--device-model', '--api-level', '--environment'],
    store: 'finalize',
    writes: 'metadata',
    schemaPointer: '/properties/metadata',
  },
};

// Flags that identify WHICH run/step is being recorded, or how, rather than
// carrying a result fact of their own. Excluded from the no-orphan check.
const IDENTITY_FLAGS = new Set([
  '--run-id',
  '--scenario-id',
  '--step-id',
  '--status',
  '--attempts',
  '--duration',
]);

module.exports = { RESULT_CAPABILITIES, IDENTITY_FLAGS };
