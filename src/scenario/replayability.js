'use strict';

// Replayability check for scenarios. Schema validity alone overstates what a
// scenario will do on replay; this module reports two kinds of gap:
//
// - `unsupported_action` (#166): the schema accepts every action in its enum,
//   but the action catalog marks some `unsupported`. mobile-mcp exposes no
//   primitive for them, so no `mauto` verb can run them and the step can never
//   replay unattended. Blocking: `mauto validate --strict` fails on it.
// - `launch_cold_default` (#255): `launch_app` now cold-starts the app unless
//   the step sets `cold: false`. A launch after the first step that leaves
//   `cold` unset may have been written to return to the running app, and now
//   restarts it instead. Advisory: it never fails `--strict`.
//
// The unsupported set is derived from the catalog, never restated here, so it
// moves when an action gains (or loses) a device primitive.

const { actionsByResolution, implicitStepFlags } = require('../device/action-catalog');

function unsupportedFinding(action, path, stepId) {
  const f = {
    code: 'unsupported_action',
    action,
    path,
    message: `${action} has no execution path in mauto; this step cannot replay unattended`,
  };
  if (stepId !== undefined) f.step_id = stepId;
  return f;
}

// One advisory per catalog marker: the step leaves `sf.field` unset, so the
// field's default decides. The catalog owns action/field/value; the wording is
// built from them.
function implicitFinding(action, sf, path, stepId) {
  const f = {
    code: sf.warnWhenUnset,
    action,
    path,
    message: `${action} now cold-starts the app (stops it first); `
      + `set "${sf.field}": ${JSON.stringify(sf.value)} if this step means to return to the running app`,
  };
  if (stepId !== undefined) f.step_id = stepId;
  return f;
}

// Walks a step list depth-first in document order, descending into each
// step's `sub_steps` (the schema types them as steps, so they nest freely).
function scanSteps(steps, basePath, unsupported, findings, topLevel) {
  if (!Array.isArray(steps)) return;
  steps.forEach((step, i) => {
    if (!step) return;
    const path = `${basePath}[${i}]`;
    if (unsupported.has(step.action)) {
      findings.push(unsupportedFinding(step.action, path, step.id));
    }
    // Only the scenario's first top-level step is unambiguously a fresh
    // start; any other step that leaves a marked field unset is worth a look.
    if (!(topLevel && i === 0)) {
      for (const sf of implicitStepFlags(step.action, step)) {
        findings.push(implicitFinding(step.action, sf, path, step.id));
      }
    }
    scanSteps(step.sub_steps, `${path}.sub_steps`, unsupported, findings, false);
  });
}

// Returns every finding in document order: steps first (including nested
// sub_steps, depth-first), then precondition device actions.
function findReplayWarnings(scenario) {
  const unsupported = new Set(actionsByResolution('unsupported'));
  const findings = [];

  scanSteps(scenario && scenario.steps, 'steps', unsupported, findings, true);

  const pre = scenario && scenario.preconditions;
  const deviceActions = pre && Array.isArray(pre.device_actions) ? pre.device_actions : [];
  deviceActions.forEach((da, i) => {
    if (da && unsupported.has(da.action)) {
      findings.push(unsupportedFinding(da.action, `preconditions.device_actions[${i}]`));
    }
  });

  return findings;
}

// The `--strict` policy: only a step that cannot run at all fails validation.
function isBlocking(finding) {
  return finding.code === 'unsupported_action';
}

const CODES = {
  unsupported_action: { blocking: true },
  launch_cold_default: { blocking: false },
};

module.exports = { findReplayWarnings, isBlocking, CODES };
