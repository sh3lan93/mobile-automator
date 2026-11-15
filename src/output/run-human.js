'use strict';

// `mauto run --human` (replay R6, #282): the run's envelope as a short summary
// a person reads in a CI log. Only an envelope carrying the run's frozen data
// (src/run/summary.js) is rendered this way; anything else — a refusal before
// the run started — falls back to the generic render. JSON output never comes
// through here.

const { render } = require('./envelope');
const { RUN_DATA_KEYS } = require('../run/summary');

const isRunData = (data) =>
  data !== null && typeof data === 'object' && !Array.isArray(data) && RUN_DATA_KEYS.every((k) => k in data);

const secondsOf = (value) => `${Math.round((Number(value) || 0) * 10) / 10}s`;

function pendingLine({ assertion_id: id, type, step_id: step }) {
  const detail = [type, step == null ? null : `after ${step}`].filter((v) => v != null);
  return `  - ${id}${detail.length ? ` (${detail.join(', ')})` : ''}`;
}

function renderRunHuman(envelope) {
  if (!envelope || !isRunData(envelope.data)) return render(envelope, { human: true });
  const d = envelope.data;
  const s = d.steps;
  const a = d.assertions;
  const lines = [];
  if (!envelope.ok && envelope.error) lines.push(`error [${envelope.error.kind}]: ${envelope.error.message}`);
  lines.push(`run ${d.run_id} (${d.scenario_id}): ${d.status} in ${secondsOf(d.duration_seconds)}`);
  lines.push(
    `steps: ${s.total} total, ${s.passed} passed, ${s.failed} failed, ${s.error} error, ${s.skipped} skipped, ${s.needs_agent} needs agent`
  );
  lines.push(`assertions: ${a.total} total, ${a.passed} passed, ${a.failed} failed, ${a.needs_agent} needs agent`);
  if (d.failed_step) lines.push(`failed step: ${d.failed_step}`);
  if (d.failures.length) lines.push('failures:', ...d.failures.map((f) => `  - ${f}`));
  if (d.pending.length) lines.push('pending:', ...d.pending.map(pendingLine));
  lines.push(`result: ${d.result_path}`);
  if (d.junit_path) lines.push(`junit: ${d.junit_path}`);
  if (envelope.hint) lines.push(`hint: ${envelope.hint}`);
  return lines.join('\n');
}

module.exports = { renderRunHuman };
