'use strict';

const { FatalStepError } = require('../fatal');
const { NeedsAgentError, NEEDS_AGENT_HANDLERS } = require('../needs-agent');

// Precondition `device_actions` (scenario.preconditions): run before step 1,
// each as a synthetic step `precondition_<n>`. Same handler contract as the
// step actions.

// A run has no pre-flight build to fall back on, so install_app needs an
// explicit artifact path in `value`; without one the agent installs the app.
async function installApp(step, { bridge }) {
  if (step.value === undefined || step.value === null || String(step.value).trim() === '') {
    throw new NeedsAgentError(
      'install_app has no value (a build path) and mauto run has no pre-flight build: install the app by hand, then finish the run'
    );
  }
  await bridge.installApp(String(step.value));
}

async function uninstallApp(step, { bridge, scenario }) {
  await bridge.uninstallApp(step.target_package || scenario.app_package);
}

async function setOrientation(step, { bridge }) {
  if (step.value === undefined || step.value === null || String(step.value).trim() === '') {
    throw new FatalStepError('set_orientation precondition has no value');
  }
  await bridge.setOrientation(String(step.value));
}

const PRECONDITION_HANDLERS = Object.freeze({
  install_app: installApp,
  uninstall_app: uninstallApp,
  set_orientation: setOrientation,
  ...NEEDS_AGENT_HANDLERS,
});

function preconditionHandlerFor(action) {
  if (Object.prototype.hasOwnProperty.call(PRECONDITION_HANDLERS, action)) return PRECONDITION_HANDLERS[action];
  return (step) => Promise.reject(new FatalStepError(`precondition action "${step.action}" is not supported by mauto run yet`));
}

module.exports = { PRECONDITION_HANDLERS, preconditionHandlerFor };
