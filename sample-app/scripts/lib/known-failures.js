'use strict';

// Expected-failure bookkeeping for the real-device E2E harness.
//
// sample-app/scenarios/golden/known-failures.json lists scenarios that are
// known to fail for a tracked reason outside this repo's control (an engine
// bug, typically), keyed by scenario id:
//
//   { "<id>": { "issue": <n>, "reason": "...", "failing_step": "<step id>" } }
//
// An entry excuses ONE failure: the scenario's first failed step being
// `failing_step`. Excusing "the scenario failed" was too broad — on a real
// device a launch failure (an unrelated uiautomator crash) was reported as the
// #251 known failure, which hid a real fault behind a stale excuse.
//
// The four outcomes, pytest-style:
//   pass  — unlisted, passed.                                Job OK.
//   fail  — failed, and not at the listed failing_step.      Job FAILS.
//   xfail — listed, and failed first at its failing_step.    Job OK.
//   xpass — listed, but passed.                              Job FAILS.
//
// xpass failing the job is the other half of the point: once the upstream fix
// lands, the entry must be removed, or the scenario would be free to regress
// again behind the excuse.

function entryFor(scenarioId, knownFailures) {
  if (!knownFailures || !Object.prototype.hasOwnProperty.call(knownFailures, scenarioId)) return null;
  return knownFailures[scenarioId] || null;
}

/**
 * @param {{scenarioId: string, passed: boolean, failedStep?: string|null, knownFailures?: object}} run
 *   `failedStep` is the id of the first step that failed, or null when every
 *   step passed (the run can still have failed on an assertion).
 */
function classify({ scenarioId, passed, failedStep = null, knownFailures = {} }) {
  const entry = entryFor(scenarioId, knownFailures);
  if (!entry) return passed ? 'pass' : 'fail';
  if (passed) return 'xpass';
  return entry.failing_step && failedStep === entry.failing_step ? 'xfail' : 'fail';
}

function isJobFailure(outcome) {
  return outcome === 'fail' || outcome === 'xpass';
}

function describeEntry(entry) {
  if (!entry) return '';
  const issue = entry.issue === undefined ? '' : `#${entry.issue}`;
  return [issue, entry.reason].filter(Boolean).join(': ');
}

function outcomeMessage({ scenarioId, outcome, knownFailures = {}, failedStep = null }) {
  const entry = entryFor(scenarioId, knownFailures);
  switch (outcome) {
    case 'pass':
      return `${scenarioId}: PASS`;
    case 'fail': {
      if (!entry) return `${scenarioId}: FAIL`;
      const actual = failedStep ? `failed at step "${failedStep}"` : 'every step passed but an assertion failed';
      return (
        `${scenarioId}: FAIL — listed as a known failure (${describeEntry(entry)}) expected to fail at step ` +
        `"${entry.failing_step}", but ${actual}. This is a different failure; it is not excused.`
      );
    }
    case 'xfail':
      return `${scenarioId}: XFAIL (known failure at step "${entry.failing_step}", ${describeEntry(entry)})`;
    case 'xpass':
      return (
        `${scenarioId}: XPASS — listed as a known failure (${describeEntry(entry)}) but it passed. ` +
        `If the fix has landed, remove "${scenarioId}" from sample-app/scenarios/golden/known-failures.json.`
      );
    default:
      return `${scenarioId}: ${outcome}`;
  }
}

module.exports = { classify, isJobFailure, outcomeMessage };
