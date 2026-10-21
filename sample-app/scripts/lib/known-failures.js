'use strict';

// Expected-failure bookkeeping for the real-device E2E harness.
//
// sample-app/scenarios/golden/known-failures.json lists scenarios that are
// known to fail for a tracked reason outside this repo's control (an engine
// bug, typically), keyed by scenario id: { "<id>": { issue, reason } }.
//
// The four outcomes, pytest-style:
//   pass  — unlisted, passed.            Job OK.
//   fail  — unlisted, failed.            Job FAILS.
//   xfail — listed, failed as expected.  Job OK.
//   xpass — listed, but passed.          Job FAILS.
//
// xpass failing the job is the point of the file: once the upstream fix lands,
// the entry must be removed, or the scenario would be free to regress again
// behind a stale excuse.

function isListed(scenarioId, knownFailures) {
  return Boolean(knownFailures) && Object.prototype.hasOwnProperty.call(knownFailures, scenarioId);
}

function classify({ scenarioId, passed, knownFailures = {} }) {
  if (isListed(scenarioId, knownFailures)) return passed ? 'xpass' : 'xfail';
  return passed ? 'pass' : 'fail';
}

function isJobFailure(outcome) {
  return outcome === 'fail' || outcome === 'xpass';
}

function describeEntry(entry) {
  if (!entry) return '';
  const issue = entry.issue === undefined ? '' : `#${entry.issue}`;
  return [issue, entry.reason].filter(Boolean).join(': ');
}

function outcomeMessage({ scenarioId, outcome, knownFailures = {} }) {
  const entry = isListed(scenarioId, knownFailures) ? knownFailures[scenarioId] : null;
  switch (outcome) {
    case 'pass':
      return `${scenarioId}: PASS`;
    case 'fail':
      return `${scenarioId}: FAIL`;
    case 'xfail':
      return `${scenarioId}: XFAIL (known failure, ${describeEntry(entry)})`;
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
