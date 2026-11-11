'use strict';

// Scenario action -> how `mauto run` performs it. Each handler is
// `async (step, ctx)`: resolves on success, throws on failure (a throw with
// `fatal: true` is not retried). Deliberately narrow — the actions the harness
// executor ran — and anything else is a loud fatal step error rather than a
// skip, so a scenario can never pass by exercising less than it claims. Later
// replay slices fill in the rest of the action catalog.

const { FatalStepError } = require('../fatal');
const { launchApp } = require('./launch');
const { tap, type } = require('./gestures');
const { SEMANTIC_HANDLERS } = require('./semantic');
const { waitForElement } = require('./wait');

const ACTION_HANDLERS = Object.freeze({
  launch_app: launchApp,
  tap,
  type,
  wait_for_element: waitForElement,
  ...SEMANTIC_HANDLERS,
});

function unsupported(step) {
  return Promise.reject(new FatalStepError(`action "${step.action}" is not supported by mauto run yet`));
}

function handlerFor(action) {
  return Object.prototype.hasOwnProperty.call(ACTION_HANDLERS, action) ? ACTION_HANDLERS[action] : unsupported;
}

module.exports = { ACTION_HANDLERS, handlerFor };
