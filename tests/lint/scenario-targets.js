'use strict';

// Shared by the guards that check scenario files for platform-agnostic
// selectors: tests/lint/e2e-agnostic.test.js (Sample Shop) and
// tests/lint/showcase-scenarios.test.js (the showcase app). One copy, so the
// two guards cannot drift on what counts as an OS element id or which
// scenario fields name an element.
//
// Pure data and functions only, no jest globals, the same way docs-corpus.js
// and workflow-guard.js are.

// OS element-id vocabulary. Comments included where it is applied: a comment
// explaining "match on the id when the label is missing" is the first draft of
// the regression.
const { flattenSteps } = require('../../src/scenario/steps');

const OS_ID_TOKEN = /identifier|resource[-_]id/i;

// The scenario fields that name or describe an element.
const STEP_FIELDS = ['target'];
const ASSERTION_FIELDS = ['target', 'element_description', 'expected_value', 'expected_substring', 'expected_text', 'label_value'];

/**
 * Every string a scenario uses to name or describe an element, with where it
 * sits (`step <id>.<field>` / `assertion <id>.<field>`) and the step it is
 * anchored to: `kind` is `step` or `assertion`, and `step` is the step's own
 * id or the assertion's `after_step`. Steps come from `flattenSteps`
 * (`src/scenario/steps.js`), so `sub_steps` are included, in document order.
 *
 * @param {object} scenario
 * @returns {{ where: string, value: string, kind: 'step'|'assertion', step: string }[]}
 */
function targetValues(scenario) {
  return valuesOf(scenario, STEP_FIELDS, ASSERTION_FIELDS);
}

// The regex fields matched against element text: a step's `target_pattern`
// (src/run/resolve.js) and a `pattern_match` assertion's `pattern`.
const STEP_PATTERN_FIELDS = ['target_pattern'];
const ASSERTION_PATTERN_FIELDS = ['pattern'];

/**
 * Every regex a scenario matches against element text, in the same shape as
 * `targetValues`.
 *
 * @param {object} scenario
 * @returns {{ where: string, value: string, kind: 'step'|'assertion', step: string }[]}
 */
function patternValues(scenario) {
  return valuesOf(scenario, STEP_PATTERN_FIELDS, ASSERTION_PATTERN_FIELDS);
}

function valuesOf(scenario, stepFields, assertionFields) {
  const out = [];
  const add = (where, value, kind, step) => {
    if (typeof value === 'string') out.push({ where, value, kind, step });
  };
  for (const { step } of flattenSteps(scenario)) for (const f of stepFields) add(`step ${step.id}.${f}`, step[f], 'step', step.id);
  for (const a of scenario.assertions || []) for (const f of assertionFields) add(`assertion ${a.id}.${f}`, a[f], 'assertion', a.after_step);
  return out;
}

module.exports = { OS_ID_TOKEN, STEP_FIELDS, ASSERTION_FIELDS, targetValues, patternValues };
