'use strict';

// Replayability check for scenarios (#166). The scenario schema accepts every
// action in its enum, but the action catalog marks some `unsupported`: mobile-mcp
// exposes no primitive for them, so no `mauto` verb can run them and the step
// can never replay unattended. Schema validity alone therefore overstates what
// a scenario can do; this module reports the gap.
//
// The unsupported set is derived from the catalog, never restated here, so it
// moves when an action gains (or loses) a device primitive.

const { actionsByResolution } = require('../device/action-catalog');

function finding(action, path, stepId) {
  const f = {
    code: 'unsupported_action',
    action,
    path,
    message: `${action} has no execution path in mauto; this step cannot replay unattended`,
  };
  if (stepId !== undefined) f.step_id = stepId;
  return f;
}

// Returns one finding per use of an unsupported action: steps first, then
// precondition device actions, each in document order.
function findUnsupportedActions(scenario) {
  const unsupported = new Set(actionsByResolution('unsupported'));
  const findings = [];

  const steps = scenario && Array.isArray(scenario.steps) ? scenario.steps : [];
  steps.forEach((step, i) => {
    if (step && unsupported.has(step.action)) {
      findings.push(finding(step.action, `steps[${i}]`, step.id));
    }
  });

  const pre = scenario && scenario.preconditions;
  const deviceActions = pre && Array.isArray(pre.device_actions) ? pre.device_actions : [];
  deviceActions.forEach((da, i) => {
    if (da && unsupported.has(da.action)) {
      findings.push(finding(da.action, `preconditions.device_actions[${i}]`));
    }
  });

  return findings;
}

module.exports = { findUnsupportedActions };
