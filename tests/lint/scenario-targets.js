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
const OS_ID_TOKEN = /identifier|resource[-_]id/i;

// The scenario fields that name or describe an element.
const STEP_FIELDS = ['target'];
const ASSERTION_FIELDS = ['target', 'element_description', 'expected_value', 'expected_substring', 'expected_text', 'label_value'];

/**
 * Every string a scenario uses to name or describe an element, with where it
 * sits (`step <id>.<field>` / `assertion <id>.<field>`).
 *
 * @param {object} scenario
 * @returns {{ where: string, value: string }[]}
 */
function targetValues(scenario) {
  const out = [];
  const add = (where, value) => {
    if (typeof value === 'string') out.push({ where, value });
  };
  for (const step of scenario.steps || []) for (const f of STEP_FIELDS) add(`step ${step.id}.${f}`, step[f]);
  for (const a of scenario.assertions || []) for (const f of ASSERTION_FIELDS) add(`assertion ${a.id}.${f}`, a[f]);
  return out;
}

module.exports = { OS_ID_TOKEN, STEP_FIELDS, ASSERTION_FIELDS, targetValues };
