'use strict';

// `mauto run` must perform, or honestly hand back, every capability the
// action catalog and the scenario schema declare (replay R3, #279). Both
// sides are derived here, never restated: a new action or precondition in
// the schema or the catalog fails this guard until the runner has a handler
// for it, and a handler for something the catalog does not know fails it too.
//
// The catalog holds both kinds of action: step actions (the step enum) and
// precondition device_actions (their own enum; clear_app_data, enable_wifi
// and disable_wifi appear in both). Steps resolve through ACTION_HANDLERS,
// preconditions through PRECONDITION_HANDLERS.

const { ACTION_CATALOG, actionsByResolution } = require('../../src/device/action-catalog');
const { ACTION_HANDLERS } = require('../../src/run/actions');
const { PRECONDITION_HANDLERS } = require('../../src/run/actions/preconditions');
const { NEEDS_AGENT_HANDLERS } = require('../../src/run/needs-agent');
const scenarioSchema = require('../../src/schemas/scenario_schema.json');

const stepActions = scenarioSchema.definitions.step.properties.action.enum;
const preconditionActions = scenarioSchema.properties.preconditions.properties.device_actions.items.properties.action.enum;
const unsupported = actionsByResolution('unsupported');
const isSupported = (a) => !unsupported.includes(a);

describe('mauto run action coverage', () => {
  test('the sets under test are non-empty (the guard is not vacuous)', () => {
    expect(stepActions.filter(isSupported).length).toBeGreaterThan(0);
    expect(unsupported.length).toBeGreaterThan(0);
    expect(preconditionActions.length).toBeGreaterThan(0);
  });

  test('every schema action is a catalog action', () => {
    for (const a of [...stepActions, ...preconditionActions]) expect(ACTION_CATALOG).toHaveProperty(a);
  });

  test.each(stepActions.filter(isSupported))('step action %s (not unsupported) has a handler', (action) => {
    expect(typeof ACTION_HANDLERS[action]).toBe('function');
  });

  test.each(preconditionActions.filter(isSupported))('precondition device_action %s (not unsupported) has a handler', (action) => {
    expect(typeof PRECONDITION_HANDLERS[action]).toBe('function');
  });

  test.each(unsupported)('unsupported action %s maps to the needs-agent handler, not to "unknown"', (action) => {
    expect(NEEDS_AGENT_HANDLERS[action]).toBeDefined();
    if (stepActions.includes(action)) expect(ACTION_HANDLERS[action]).toBe(NEEDS_AGENT_HANDLERS[action]);
    if (preconditionActions.includes(action)) expect(PRECONDITION_HANDLERS[action]).toBe(NEEDS_AGENT_HANDLERS[action]);
  });

  test('every non-unsupported catalog action is handled as a step or as a precondition', () => {
    const unhandled = Object.keys(ACTION_CATALOG).filter(
      (a) => isSupported(a) && !(a in ACTION_HANDLERS) && !(a in PRECONDITION_HANDLERS)
    );
    expect(unhandled).toEqual([]);
  });

  test('no step handler is keyed by anything but a catalog action', () => {
    expect(Object.keys(ACTION_HANDLERS).filter((a) => !(a in ACTION_CATALOG))).toEqual([]);
  });

  test('no precondition handler is keyed by anything but a precondition enum value', () => {
    expect(Object.keys(PRECONDITION_HANDLERS).filter((a) => !preconditionActions.includes(a))).toEqual([]);
  });

  test('a needs-agent handler exists only for an unsupported catalog action', () => {
    expect(Object.keys(NEEDS_AGENT_HANDLERS).filter((a) => !unsupported.includes(a))).toEqual([]);
  });
});
