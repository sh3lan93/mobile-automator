'use strict';

// Replayability check for scenarios. Schema validity alone overstates what a
// scenario will do on replay; this module reports three kinds of gap:
//
// - `unsupported_action` (#166): the schema accepts every action in its enum,
//   but the action catalog marks some `unsupported`. no `mauto` verb reaches
//   them, whether or not the engine has a primitive, so the step can never
//   replay unattended. Blocking: `mauto validate --strict` fails on it.
// - `launch_cold_implicit` (#255): a catalog `stepFlags` entry marked
//   `warnWhenUnset`. A step after the first that leaves the marked field to its
//   schema default is ambiguous about the author's intent. Advisory: it never
//   fails `--strict`.
// - Referential gaps (#272): duplicate step ids, dangling references, steps
//   with no target, undeclared variables, waits with no `wait_config`. The
//   `references` module owns those codes; this one merges its findings into
//   the single walk over `flattenSteps`, so `CODES` stays the one table
//   every consumer reads.
//
// The unsupported set is derived from the catalog, never restated here, so it
// moves when an action gains (or loses) a device primitive.

const { actionsByResolution, implicitStepFlags } = require('../device/action-catalog');
const {
  REFERENCE_CODES,
  referenceIndex,
  stepReferences,
  assertionReferences,
} = require('./references');
const { flattenSteps } = require('./steps');

// Severity and wording for every finding code: the replay codes are defined
// here, the referential ones in `references.js`, and `CODES` assembles both, so
// it is the one table every consumer reads.
// `blocking` is the `--strict` policy: a blocking finding means the scenario
// cannot replay unattended as written: a step that cannot run or a broken
// reference. `clause(n)` is the hint fragment for n findings of the code;
// `message(f)` is the per-finding text.
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
  ...REFERENCE_CODES,
};

// The one constructor for a `data.warnings` entry: `{ code, action, path,
// message }` plus `step_id` or `assertion_id` from `ids`. `action` is omitted
// when the finding has none (an assertion).
function makeFinding(code, fields, path, ids = {}) {
  const f = { code };
  if (fields.action !== undefined) f.action = fields.action;
  f.path = path;
  f.message = CODES[code].message(fields);
  return Object.assign(f, ids);
}

const stepIds = (step) => (step.id !== undefined ? { step_id: step.id } : {});

// Returns every finding in document order: steps first (including nested
// sub_steps, depth-first), then precondition device actions, then assertions.
function findReplayWarnings(scenario) {
  const unsupported = new Set(actionsByResolution('unsupported'));
  const entries = flattenSteps(scenario);
  const index = referenceIndex(scenario, entries);
  const findings = [];

  entries.forEach(({ step, path, isFirstTopLevel }, position) => {
    const ids = stepIds(step);
    const add = (code, fields) => findings.push(makeFinding(code, { action: step.action, ...fields }, path, ids));
    if (unsupported.has(step.action)) add('unsupported_action', {});
    // Only the scenario's first top-level step is unambiguously a fresh
    // start; any other step that leaves a marked field unset is worth a look.
    // The catalog owns the marker's code, field and default value.
    if (!isFirstTopLevel) {
      for (const sf of implicitStepFlags(step.action, step)) {
        add(sf.warnWhenUnset, { field: sf.field, value: sf.value });
      }
    }
    for (const r of stepReferences(step, position, index)) add(r.code, r.fields);
  });

  const pre = scenario && scenario.preconditions;
  const deviceActions = pre && Array.isArray(pre.device_actions) ? pre.device_actions : [];
  deviceActions.forEach((da, i) => {
    if (da && unsupported.has(da.action)) {
      findings.push(makeFinding('unsupported_action', { action: da.action }, `preconditions.device_actions[${i}]`));
    }
  });

  for (const r of assertionReferences(scenario, index)) findings.push(makeFinding(r.code, r.fields, r.path, r.ids));

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
