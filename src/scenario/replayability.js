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

// Walks a step list depth-first in document order, descending into each
// step's `sub_steps` (the schema types them as steps, so they nest freely).
function scanSteps(steps, basePath, unsupported, findings) {
  if (!Array.isArray(steps)) return;
  steps.forEach((step, i) => {
    if (!step) return;
    const path = `${basePath}[${i}]`;
    if (unsupported.has(step.action)) {
      findings.push(finding(step.action, path, step.id));
    }
    scanSteps(step.sub_steps, `${path}.sub_steps`, unsupported, findings);
  });
}

// Returns one finding per use of an unsupported action: steps first (including
// nested sub_steps, depth-first in document order), then precondition device
// actions in document order.
function findUnsupportedActions(scenario) {
  const unsupported = new Set(actionsByResolution('unsupported'));
  const findings = [];

  scanSteps(scenario && scenario.steps, 'steps', unsupported, findings);

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
