'use strict';

// Referential checks for scenarios (#272). The schema types every reference as
// a bare string, so a scenario whose ids, targets and variables do not line up
// still validates -- and the gap surfaces mid-run, on a device. This module
// reports those gaps as finding descriptors -- `{ code, fields }`, plus `path`
// and `ids` for assertions -- and `replayability.js` turns them into warnings
// with its one constructor, during its one walk over the steps, so `validate`
// sees one finding list in one shape.
//
// Every code but `missing_wait_config` is blocking: the step or assertion has
// nothing to resolve against, so it cannot replay unattended. A wait without
// `wait_config` still runs on the default timeout, so that one is advisory.

// Step actions that locate an element on screen, so need a `target` (or a
// `target_pattern`) to resolve it.
const TARGET_ACTIONS = new Set([
  'tap',
  'long_press',
  'double_tap',
  'wait_for_element',
  'wait_for_element_gone',
  'scroll_to_element',
  'capture_value',
]);

// Step actions the schema's `wait_config` configures.
const WAIT_ACTIONS = new Set(['wait_for_element', 'wait_for_element_gone', 'wait_for_loading_complete']);

const REFERENCE_CODES = {
  duplicate_step_id: {
    blocking: true,
    clause: (n) => `${n} step id(s) are declared more than once`,
    message: (f) => `step id "${f.ref}" is already used by ${f.firstPath}; `
      + 'step ids must be unique so assertions and conditions can name one step',
  },
  dangling_after_step: {
    blocking: true,
    clause: (n) => `${n} assertion(s) run after a step that does not exist`,
    message: (f) => (f.ref === undefined
      ? 'assertion has no "after_step"; name the step it runs after'
      : `assertion runs after step "${f.ref}", which no step declares`),
  },
  missing_target: {
    blocking: true,
    clause: (n) => `${n} step(s) have no target to resolve`,
    message: (f) => `${f.action} has no "target" (or "target_pattern"), so there is no element to resolve`,
  },
  undeclared_capture_variable: {
    blocking: true,
    clause: (n) => `${n} variable reference(s) are not declared in "variables"`,
    message: (f) => `"${f.field}" names variable "${f.ref}", which the root "variables" block does not declare`,
  },
  dangling_condition_step: {
    blocking: true,
    clause: (n) => `${n} condition(s) refer to a step that has not run`,
    message: (f) => (f.ref === undefined
      ? 'previous_step_skipped condition has no "step_id"; name an earlier step'
      : `previous_step_skipped condition names step "${f.ref}", which is not an earlier step`),
  },
  missing_wait_config: {
    blocking: false,
    clause: (n) => `${n} wait step(s) have no wait_config; the default timeout applies`,
    message: (f) => `${f.action} has no "wait_config", so it waits for the default timeout; `
      + 'set "wait_config" to make the wait explicit',
  },
};

const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;

// Indexes the flattened step list (see `steps.js`): `after_step` and duplicate
// detection need every step, and a condition's step must come earlier, i.e.
// at a lower position in `entries`.
function referenceIndex(scenario, entries) {
  const firstPathById = new Map();
  const orderById = new Map();
  entries.forEach(({ step, path }, position) => {
    if (typeof step.id === 'string' && !firstPathById.has(step.id)) {
      firstPathById.set(step.id, path);
      orderById.set(step.id, position);
    }
  });

  const vars = scenario && scenario.variables;
  const variables = new Set(vars && typeof vars === 'object' && !Array.isArray(vars) ? Object.keys(vars) : []);
  return { firstPathById, orderById, variables };
}

// Descriptors for one step; the caller supplies its path, action and id.
// `position` is its index in the flattened step list, the same numbering
// `orderById` uses.
function stepReferences(step, position, index) {
  const findings = [];
  const add = (code, fields) => findings.push({ code, fields });

  const firstPath = index.firstPathById.get(step.id);
  if (firstPath !== undefined && index.orderById.get(step.id) !== position) {
    add('duplicate_step_id', { ref: step.id, firstPath });
  }

  if (TARGET_ACTIONS.has(step.action) && !isNonEmptyString(step.target) && !isNonEmptyString(step.target_pattern)) {
    add('missing_target', {});
  }

  if (WAIT_ACTIONS.has(step.action) && !step.wait_config) {
    add('missing_wait_config', {});
  }

  if (step.capture_to !== undefined && !index.variables.has(step.capture_to)) {
    add('undeclared_capture_variable', { field: 'capture_to', ref: step.capture_to });
  }

  const cond = step.condition;
  if (cond && typeof cond === 'object') {
    if (cond.variable_name !== undefined && !index.variables.has(cond.variable_name)) {
      add('undeclared_capture_variable', { field: 'condition.variable_name', ref: cond.variable_name });
    }
    if (cond.type === 'previous_step_skipped') {
      const order = index.orderById.get(cond.step_id);
      if (order === undefined || order >= position) {
        add('dangling_condition_step', { ref: cond.step_id });
      }
    }
  }

  return findings;
}

// Descriptors for the root `assertions` array, in order, each with its path
// and `assertion_id`.
function assertionReferences(scenario, index) {
  const assertions = scenario && scenario.assertions;
  if (!Array.isArray(assertions)) return [];
  const findings = [];
  assertions.forEach((a, i) => {
    if (!a) return;
    const path = `assertions[${i}]`;
    const ids = a.id !== undefined ? { assertion_id: a.id } : {};
    if (!index.firstPathById.has(a.after_step)) {
      findings.push({ code: 'dangling_after_step', fields: { ref: a.after_step }, path, ids });
    }
    if (a.variable_name !== undefined && !index.variables.has(a.variable_name)) {
      findings.push({
        code: 'undeclared_capture_variable', fields: { field: 'variable_name', ref: a.variable_name }, path, ids,
      });
    }
  });
  return findings;
}

module.exports = {
  REFERENCE_CODES,
  referenceIndex,
  stepReferences,
  assertionReferences,
};
