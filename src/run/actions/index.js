'use strict';

// Scenario action -> how `mauto run` performs it. Each handler is
// `async (step, ctx)`: resolves on success, throws on failure (a throw with
// `fatal: true` is not retried). `ctx.observe(message)` notes something worth
// knowing about a step that did not fail it; runStep records each note as a
// state_context observation. Every action the action catalog does not mark
// `unsupported` has a handler here, and every `unsupported` one maps to the
// needs-agent handler (the guard is tests/lint/run-action-coverage.test.js).
// An action with no entry is a loud fatal step error rather than a skip, so a
// scenario can never pass by exercising less than it claims.

const { FatalStepError } = require('../fatal');
const { launchApp } = require('./launch');
const { tap, type, longPress, doubleTap, swipe, pressButton, openUrl } = require('./gestures');
const { scrollToElement } = require('./scroll');
const { captureValue } = require('./capture');
const { SEMANTIC_HANDLERS } = require('./semantic');
const { NEEDS_AGENT_HANDLERS } = require('../needs-agent');
const { waitForElement, waitForElementGone, waitForLoadingComplete } = require('./wait');

const ACTION_HANDLERS = Object.freeze({
  launch_app: launchApp,
  tap,
  type,
  long_press: longPress,
  double_tap: doubleTap,
  swipe,
  press_button: pressButton,
  open_url: openUrl,
  scroll_to_element: scrollToElement,
  wait_for_element: waitForElement,
  wait_for_element_gone: waitForElementGone,
  wait_for_loading_complete: waitForLoadingComplete,
  capture_value: captureValue,
  ...SEMANTIC_HANDLERS,
  ...NEEDS_AGENT_HANDLERS,
});

function unsupported(step) {
  return Promise.reject(new FatalStepError(`action "${step.action}" is not supported by mauto run yet`));
}

function handlerFor(action) {
  return Object.prototype.hasOwnProperty.call(ACTION_HANDLERS, action) ? ACTION_HANDLERS[action] : unsupported;
}

module.exports = { ACTION_HANDLERS, handlerFor };
