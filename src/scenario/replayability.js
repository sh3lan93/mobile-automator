'use strict';

// Replayability check for scenarios. Schema validity alone overstates what a
// scenario will do on replay; this module reports two kinds of gap:
//
// - `unsupported_action` (#166): the schema accepts every action in its enum,
//   but the action catalog marks some `unsupported`. mobile-mcp exposes no
//   primitive for them, so no `mauto` verb can run them and the step can never
//   replay unattended. Blocking: `mauto validate --strict` fails on it.
// - `launch_cold_implicit` (#255): a catalog `stepFlags` entry marked
//   `warnWhenUnset`. A step after the first that leaves the marked field to its
//   schema default is ambiguous about the author's intent. Advisory: it never
//   fails `--strict`.
//
// The unsupported set is derived from the catalog, never restated here, so it
// moves when an action gains (or loses) a device primitive.

const { actionsByResolution, implicitStepFlags } = require('../device/action-catalog');

// Severity and wording for every finding code live here and nowhere else.
// `blocking` is the `--strict` policy: only a step that cannot run at all fails
// validation. `clause(n)` is the hint fragment for n findings of the code;
// `message(f)` is the per-finding text. Advisory codes other than
// `unsupported_action` are the catalog's `warnWhenUnset` markers.
const CODES = {
  unsupported_action: {
    blocking: true,
    clause: (n) => `${n} action(s) cannot replay unattended`,
    message: (f) => `${f.action} has no execution path in mauto; this step cannot replay unattended`,
  },
  launch_cold_implicit: {
    blocking: false,
    clause: (n) => `${n} step(s) leave an optional field unset; set it explicitly`,
    message: (f) => `${f.action} leaves "${f.field}" unset, so it restarts the app; `
      + `set "${f.field}" explicitly (${JSON.stringify(f.value)} to return to the running app, `
      + `${JSON.stringify(!f.value)} to confirm the restart)`,
  },
};

function makeFinding(code, fields, path, stepId) {
  const f = { code, action: fields.action, path, message: CODES[code].message(fields) };
  if (stepId !== undefined) f.step_id = stepId;
  return f;
}

function unsupportedFinding(action, path, stepId) {
  return makeFinding('unsupported_action', { action }, path, stepId);
}

// One advisory per catalog marker: the step leaves `sf.field` unset, so the
// field's default decides. The catalog owns action/field/value.
function implicitFinding(action, sf, path, stepId) {
  return makeFinding(sf.warnWhenUnset, { action, field: sf.field, value: sf.value }, path, stepId);
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

function isBlocking(finding) {
  const row = CODES[finding.code];
  return Boolean(row && row.blocking);
}

// Splits findings into the `--strict`-failing ones and builds the one-line
// hint: blocking clauses first, then advisories, one clause per code (counted),
// each ending `— see data.warnings`. A code without a CODES row is advisory
// with a generic clause.
function summarize(findings) {
  const blocking = findings.filter(isBlocking);
  const counts = new Map();
  for (const f of findings) counts.set(f.code, (counts.get(f.code) || 0) + 1);
  const clauseOf = (code, n) => {
    const row = CODES[code];
    return `${row && row.clause ? row.clause(n) : `${n} ${code} finding(s)`} — see data.warnings`;
  };
  const codes = [...counts.keys()];
  const ordered = [
    ...codes.filter((c) => CODES[c] && CODES[c].blocking),
    ...codes.filter((c) => !(CODES[c] && CODES[c].blocking)),
  ];
  return { blocking, hint: ordered.map((c) => clauseOf(c, counts.get(c))).join('; ') };
}

module.exports = { findReplayWarnings, summarize, isBlocking, CODES };
