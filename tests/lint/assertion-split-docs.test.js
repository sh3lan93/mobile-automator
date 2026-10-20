'use strict';

// Guard: the assertions reference must say which assertion types `mauto assert`
// decides and which it hands back to the agent. The split is real behavior, not
// prose: MECHANICAL_TYPES in the evaluator is the source of truth, and every
// other schema type returns `needs_agent` with `pass: null`. A table that
// quietly claims all 27 are verified by the CLI would overstate what a green
// run proves (#166), so the table is derived-checked against the code.

const fs = require('fs');
const path = require('path');

const { MECHANICAL_TYPES } = require('../../src/assertion/evaluator');
const schema = require('../../src/schemas/scenario_schema.json');

const REPO = path.join(__dirname, '..', '..');
const SCHEMA_TYPES = schema.definitions.assertion.properties.type.enum;

// Rows of the Quick Reference table: | type | category | evaluated by |
function parseQuickReference() {
  const lines = fs
    .readFileSync(path.join(REPO, 'docs', 'reference', 'assertions.md'), 'utf8')
    .split('\n');
  const start = lines.findIndex((l) => /^##\s+Quick Reference Table/.test(l));
  expect(start).toBeGreaterThanOrEqual(0);
  const rows = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    const cells = line.split('|').map((c) => c.trim());
    // ['', type, category, evaluatedBy, '']
    if (cells.length < 5 || cells[1] === 'Type' || /^-+$/.test(cells[1])) continue;
    rows.push({ type: cells[1], evaluatedBy: cells[3] });
  }
  return rows;
}

describe('assertions reference documents the mechanical / agent-judged split', () => {
  const rows = parseQuickReference();
  const mechanicalDoc = rows.filter((r) => /^`mauto assert`/.test(r.evaluatedBy)).map((r) => r.type);
  const agentDoc = rows.filter((r) => r.evaluatedBy === 'agent').map((r) => r.type);

  test('every row is classified as `mauto assert` or agent', () => {
    const unclassified = rows
      .filter((r) => !mechanicalDoc.includes(r.type) && !agentDoc.includes(r.type))
      .map((r) => `${r.type}: "${r.evaluatedBy}"`);
    expect(unclassified).toEqual([]);
  });

  test('every schema assertion type appears exactly once', () => {
    const seen = rows.map((r) => r.type);
    const missing = SCHEMA_TYPES.filter((t) => !seen.includes(t));
    const unknown = seen.filter((t) => !SCHEMA_TYPES.includes(t));
    const duplicated = seen.filter((t, i) => seen.indexOf(t) !== i);
    expect({ missing, unknown, duplicated }).toEqual({ missing: [], unknown: [], duplicated: [] });
  });

  test('the mechanical set equals MECHANICAL_TYPES', () => {
    expect([...mechanicalDoc].sort()).toEqual([...MECHANICAL_TYPES].sort());
  });

  test('the agent-judged set equals the schema types minus MECHANICAL_TYPES', () => {
    const want = SCHEMA_TYPES.filter((t) => !MECHANICAL_TYPES.has(t));
    expect([...agentDoc].sort()).toEqual([...want].sort());
  });
});
