'use strict';

// Expected-failure bookkeeping for the real-device E2E harness.
//
// sample-app/scenarios/golden/known-failures.json lists scenarios that are
// known to fail for a tracked reason outside this repo's control (an engine
// bug, typically), keyed by scenario id:
//
//   { "<id>": { "issue": <n>, "reason": "...", "failing_step": "<step id>",
//               "engines": ["mobilecli"] } }
//
// `engines` is optional: absent, the entry applies on every engine; present,
// only on the engines it names (values from the config schema's `engine` enum,
// guarded by tests/lint/e2e-agnostic.test.js). On any other engine the entry
// does not exist — the scenario must pass, and a failure there is a plain FAIL.
// #251 is the case: the default mobilecli robot drops TextField labels, the
// legacy robot does not, so golden_search_empty is excused on mobilecli only.
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

// The entry that applies to this scenario on this engine, or null. An entry
// scoped to engines with no current engine is a harness fault, thrown rather
// than guessed: ignoring it would turn the excuse into a silent pass.
function entryFor(scenarioId, knownFailures, engine) {
  if (!knownFailures || !Object.prototype.hasOwnProperty.call(knownFailures, scenarioId)) return null;
  const entry = knownFailures[scenarioId] || null;
  if (!entry || !Array.isArray(entry.engines)) return entry;
  if (typeof engine !== 'string' || !engine) {
    throw new Error(
      `known failure "${scenarioId}" is scoped to engines [${entry.engines.join(', ')}], but no current engine was given`
    );
  }
  return entry.engines.includes(engine) ? entry : null;
}

/**
 * @param {{scenarioId: string, passed: boolean, failedStep?: string|null, knownFailures?: object, engine?: string}} run
 *   `failedStep` is the id of the first step that failed, or null when every
 *   step passed (the run can still have failed on an assertion). `engine` is
 *   the engine the run used; required when the scenario's entry has `engines`.
 */
function classify({ scenarioId, passed, failedStep = null, knownFailures = {}, engine }) {
  const entry = entryFor(scenarioId, knownFailures, engine);
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
  const scope = Array.isArray(entry.engines) ? `on ${entry.engines.join(', ')}` : '';
  return [[issue, scope].filter(Boolean).join(' '), entry.reason].filter(Boolean).join(': ');
}

function outcomeMessage({ scenarioId, outcome, knownFailures = {}, failedStep = null, engine }) {
  const entry = entryFor(scenarioId, knownFailures, engine);
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
        `If the fix has landed, remove "${scenarioId}" from sample-app/scenarios/golden/known-failures.json` +
        (Array.isArray(entry.engines) && entry.engines.length > 1 ? ` (or drop ${engine} from its engines).` : '.')
      );
    default:
      return `${scenarioId}: ${outcome}`;
  }
}

module.exports = { classify, isJobFailure, outcomeMessage };
