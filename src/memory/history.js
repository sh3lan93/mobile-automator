'use strict';

// Pure model for run-history.md — a rolling per-scenario aggregate. Bounded by
// scenario count (not run count): each scenario keeps its last MAX_RUNS pass/fail
// letters and last MAX_NOTES observation bullets. No I/O here.

const MAX_RUNS = 5;
const MAX_NOTES = 10;

const HEADER = '# Run History';
const HEADER_COMMENT =
  '<!-- Managed by `mauto memory`. Auto-harvested on `result finalize`. -->';

// `## <scenarioId>  (last N runs: P F ...)`  — scenarioId is everything before
// the two-space gap that precedes the "(last".
const HEADING_RE = /^##\s+(.+?)\s+\(last \d+ runs:\s*([^)]*)\)\s*$/;
const NOTE_RE = /^-\s+\[(\d{4}-\d{2}-\d{2})\]\[observed\]\s+(.*)$/;

function emptyModel() {
  return { order: [], byScenario: {} };
}

function ensure(model, scenarioId) {
  if (!model.byScenario[scenarioId]) {
    model.byScenario[scenarioId] = { runs: [], notes: [] };
    model.order.push(scenarioId);
  }
  return model.byScenario[scenarioId];
}

function recordInModel(model, { scenarioId, statusLetter, notes = [] }) {
  const entry = ensure(model, scenarioId);
  entry.runs.push(statusLetter);
  if (entry.runs.length > MAX_RUNS) entry.runs = entry.runs.slice(-MAX_RUNS);
  for (const n of notes) entry.notes.push(n);
  if (entry.notes.length > MAX_NOTES) entry.notes = entry.notes.slice(-MAX_NOTES);
  return model;
}

function parseRunHistory(md) {
  const model = emptyModel();
  if (!md) return model;
  let current = null;
  for (const line of md.split('\n')) {
    const h = line.match(HEADING_RE);
    if (h) {
      const id = h[1].trim();
      current = ensure(model, id);
      const letters = h[2].trim();
      current.runs = letters ? letters.split(/\s+/).filter(Boolean) : [];
      continue;
    }
    const n = line.match(NOTE_RE);
    if (n && current) {
      current.notes.push({ date: n[1], text: n[2] });
    }
  }
  return model;
}

function renderRunHistory(model) {
  const out = [HEADER, HEADER_COMMENT, ''];
  for (const id of model.order) {
    const e = model.byScenario[id];
    out.push(`## ${id}  (last ${MAX_RUNS} runs: ${e.runs.join(' ')})`);
    for (const note of e.notes) {
      out.push(`- [${note.date}][observed] ${note.text}`);
    }
    out.push('');
  }
  return out.join('\n').replace(/\n+$/, '\n');
}

function countEntries(model) {
  return model.order.reduce((sum, id) => sum + model.byScenario[id].notes.length, 0);
}

module.exports = {
  MAX_RUNS,
  MAX_NOTES,
  emptyModel,
  parseRunHistory,
  renderRunHistory,
  recordInModel,
  countEntries,
};
