'use strict';

// Precondition device_actions and the needs-agent actions: handlers driven
// against the scripted fake bridge, plus the runner's treatment of both.

const evaluator = require('../../../src/assertion/evaluator');
const catalog = require('../../../src/device/action-catalog');
const { PRECONDITION_HANDLERS, preconditionHandlerFor } = require('../../../src/run/actions/preconditions');
const { NeedsAgentError, NEEDS_AGENT_HANDLERS } = require('../../../src/run/needs-agent');
const { ACTION_HANDLERS } = require('../../../src/run/actions');
const { runSettings } = require('../../../src/run/settings');
const { makeFakeBridge, makeFakeClock } = require('../../helpers/fake-bridge');

function ctxFor(bridge, extra = {}) {
  return {
    scenario: { scenario_id: 'demo', app_package: 'com.example.app' },
    settings: runSettings(null),
    variables: {},
    bridge,
    evaluator,
    catalog,
    clock: makeFakeClock(),
    observe: () => {},
    ...extra,
  };
}

describe('install_app precondition', () => {
  test('installs the build at value', async () => {
    const b = makeFakeBridge();
    await PRECONDITION_HANDLERS.install_app({ id: 'precondition_1', action: 'install_app', value: '/tmp/app.apk' }, ctxFor(b));
    expect(b.of('installApp')[0].args).toEqual(['/tmp/app.apk']);
  });

  test('without a value it needs an agent: a run has no pre-flight build', async () => {
    const b = makeFakeBridge();
    const err = await PRECONDITION_HANDLERS.install_app({ id: 'precondition_1', action: 'install_app' }, ctxFor(b)).catch((e) => e);
    expect(err).toBeInstanceOf(NeedsAgentError);
    expect(err.message).toMatch(/install_app/);
    expect(b.calls).toEqual([]);
  });
});

describe('uninstall_app precondition', () => {
  test('uninstalls target_package', async () => {
    const b = makeFakeBridge();
    await PRECONDITION_HANDLERS.uninstall_app({ id: 'p', action: 'uninstall_app', target_package: 'com.other' }, ctxFor(b));
    expect(b.of('uninstallApp')[0].args).toEqual(['com.other']);
  });

  test("defaults to the scenario's app_package", async () => {
    const b = makeFakeBridge();
    await PRECONDITION_HANDLERS.uninstall_app({ id: 'p', action: 'uninstall_app' }, ctxFor(b));
    expect(b.of('uninstallApp')[0].args).toEqual(['com.example.app']);
  });
});

describe('set_orientation precondition', () => {
  test('sets the orientation', async () => {
    const b = makeFakeBridge();
    await PRECONDITION_HANDLERS.set_orientation({ id: 'p', action: 'set_orientation', value: 'landscape' }, ctxFor(b));
    expect(b.of('setOrientation')[0].args).toEqual(['landscape']);
  });

  test('no value is fatal', async () => {
    const b = makeFakeBridge();
    const err = await PRECONDITION_HANDLERS.set_orientation({ id: 'p', action: 'set_orientation' }, ctxFor(b)).catch((e) => e);
    expect(err.fatal).toBe(true);
    expect(err.message).toBe('set_orientation precondition has no value');
  });
});

describe('needs-agent actions', () => {
  test.each(['clear_app_data', 'enable_wifi', 'disable_wifi'])('%s throws NeedsAgentError naming what to do by hand', async (action) => {
    const b = makeFakeBridge();
    const err = await NEEDS_AGENT_HANDLERS[action]({ id: 's', action }, ctxFor(b)).catch((e) => e);
    expect(err).toBeInstanceOf(NeedsAgentError);
    expect(err.needsAgent).toBe(true);
    expect(err.message).toContain(action);
    expect(b.calls).toEqual([]);
  });

  test('the same handlers serve steps and preconditions', () => {
    for (const action of Object.keys(NEEDS_AGENT_HANDLERS)) {
      expect(ACTION_HANDLERS[action]).toBe(NEEDS_AGENT_HANDLERS[action]);
      expect(PRECONDITION_HANDLERS[action]).toBe(NEEDS_AGENT_HANDLERS[action]);
    }
  });

  test('an unknown precondition action gets a fatal handler', async () => {
    const err = await preconditionHandlerFor('teleport')({ id: 'p', action: 'teleport' }, ctxFor(makeFakeBridge())).catch((e) => e);
    expect(err.fatal).toBe(true);
    expect(err.message).toBe('precondition action "teleport" is not supported by mauto run yet');
  });
});
