'use strict';

// The ctx a `mauto run` handler receives, for unit tests that drive one
// handler directly: the same settings, variables and `pollUntil` runScenario
// builds, over a fake bridge and clock. `extra` overrides any field;
// `pollUntil` is derived from the FINAL settings and clock unless given.

const evaluator = require('../../src/assertion/evaluator');
const catalog = require('../../src/device/action-catalog');
const { makePollUntil } = require('../../src/run/poll');
const { runSettings } = require('../../src/run/settings');
const { makeFakeClock } = require('./fake-bridge');

function makeRunCtx(bridge, extra = {}) {
  const ctx = {
    scenario: { scenario_id: 'demo', app_package: 'com.example.app' },
    settings: runSettings(null),
    variables: {},
    store: { captureVariable: jest.fn() },
    bridge,
    evaluator,
    catalog,
    clock: makeFakeClock(),
    observe: () => {},
    ...extra,
  };
  return { ...ctx, pollUntil: extra.pollUntil || makePollUntil(ctx.settings, ctx.clock) };
}

module.exports = { makeRunCtx };
