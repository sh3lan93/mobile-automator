'use strict';

// Golden comparison for the real-device E2E harness.
//
// A result file carries two kinds of fact. MECHANICAL ones — which steps ran,
// whether each passed, which assertions were recorded and their verdicts — are
// what a given app build + scenario + CLI version must reproduce every run.
// INCIDENTAL ones — run_id, timestamps, durations, device/app/environment
// metadata, screenshot paths, the wording of messages, trace measurements —
// change every run and say nothing about whether the CLI regressed.
//
// normalizeResult keeps only the first kind, so a checked-in golden can be
// compared byte-for-byte against a fresh run. Field names are the result
// schema's own (`mauto schema result`): steps live in `steps_executed`,
// assertions in `assertion_results` with a `status` of passed|failed.

function normalizeResult(result) {
  const r = result || {};
  const steps = Array.isArray(r.steps_executed) ? r.steps_executed : [];
  const assertions = Array.isArray(r.assertion_results) ? r.assertion_results : [];
  return {
    scenario_id: r.scenario_id === undefined ? null : r.scenario_id,
    status: r.status === undefined ? null : r.status,
    total_assertions: r.total_assertions === undefined ? assertions.length : r.total_assertions,
    passed_assertions: r.passed_assertions === undefined ? null : r.passed_assertions,
    failed_assertions: r.failed_assertions === undefined ? null : r.failed_assertions,
    step_count: steps.length,
    steps_executed: steps.map((s) => ({ step_id: s.step_id, status: s.status })),
    assertion_results: assertions.map((a) => ({ assertion_id: a.assertion_id, status: a.status })),
  };
}

const isObject = (v) => v !== null && typeof v === 'object';
const show = (v) => JSON.stringify(v);

// Human-readable differences between an expected and an actual normalized
// result, one line per differing leaf, addressed by path
// (`steps_executed[1].status: expected "passed", got "failed"`). Empty when
// equal. Generic over the shape so a field added to normalizeResult is diffed
// without touching this.
//
// Top-level keys starting with `_` are annotations on a checked-in golden
// (`_provenance`: where and how it was generated), not facts about a run, so
// they are dropped from both sides before comparing.
function diffNormalized(expected, actual) {
  return diffValues(stripAnnotations(expected), stripAnnotations(actual), '');
}

function stripAnnotations(v) {
  if (!isObject(v) || Array.isArray(v)) return v;
  return Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('_')));
}

function diffValues(expected, actual, at) {
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const lines = [];
    for (let i = 0; i < Math.max(expected.length, actual.length); i++) {
      const p = `${at}[${i}]`;
      if (i >= actual.length) lines.push(`${p}: missing (expected ${show(expected[i])})`);
      else if (i >= expected.length) lines.push(`${p}: unexpected ${show(actual[i])}`);
      else lines.push(...diffValues(expected[i], actual[i], p));
    }
    return lines;
  }
  if (isObject(expected) && isObject(actual) && !Array.isArray(expected) && !Array.isArray(actual)) {
    const lines = [];
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])];
    for (const k of keys) {
      const p = at ? `${at}.${k}` : k;
      if (!(k in actual)) lines.push(`${p}: missing (expected ${show(expected[k])})`);
      else if (!(k in expected)) lines.push(`${p}: unexpected ${show(actual[k])}`);
      else lines.push(...diffValues(expected[k], actual[k], p));
    }
    return lines;
  }
  if (show(expected) === show(actual)) return [];
  return [`${at || '<root>'}: expected ${show(expected)}, got ${show(actual)}`];
}

module.exports = { normalizeResult, diffNormalized };
