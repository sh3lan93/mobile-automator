'use strict';

// Guard: the assertions reference must say which assertion types `mauto assert`
// decides and which it hands back to the agent. The split is real behavior, not
// prose: MECHANICAL_TYPES (decided over the element list) and
// REFERENCE_SCREENSHOT_TYPES (decided by a pixel diff against a reference
// screenshot) in the evaluator are the source of truth, and every other schema
// type returns `needs_agent` with `pass: null`. A table that quietly claims all
// 27 are verified by the CLI would overstate what a green run proves (#166), so
// the table is derived-checked against the code.

const fs = require('fs');
const path = require('path');

const { MECHANICAL_TYPES, REFERENCE_SCREENSHOT_TYPES } = require('../../src/assertion/evaluator');
const schema = require('../../src/schemas/scenario_schema.json');

const REPO = path.join(__dirname, '..', '..');
const SCHEMA_TYPES = schema.definitions.assertion.properties.type.enum;

const MECHANICAL_CELL = '`mauto assert` (mechanical)';
const REFERENCE_CELL = '`mauto assert` (reference screenshot)';
const AGENT_CELL = 'agent';

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

describe('assertions reference documents the mechanical / reference-screenshot / agent-judged split', () => {
  const rows = parseQuickReference();
  const ofClass = (cell) => rows.filter((r) => r.evaluatedBy === cell).map((r) => r.type);
  const mechanicalDoc = ofClass(MECHANICAL_CELL);
  const referenceDoc = ofClass(REFERENCE_CELL);
  const agentDoc = ofClass(AGENT_CELL);

  test('the evaluator exports both CLI-decided sets, and they are disjoint', () => {
    expect(MECHANICAL_TYPES).toBeInstanceOf(Set);
    expect(REFERENCE_SCREENSHOT_TYPES).toBeInstanceOf(Set);
    const overlap = [...MECHANICAL_TYPES].filter((t) => REFERENCE_SCREENSHOT_TYPES.has(t));
    expect(overlap).toEqual([]);
  });

  test('every row is classified as mechanical, reference screenshot, or agent', () => {
    const unclassified = rows
      .filter((r) => ![MECHANICAL_CELL, REFERENCE_CELL, AGENT_CELL].includes(r.evaluatedBy))
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

  test('the reference-screenshot set equals REFERENCE_SCREENSHOT_TYPES', () => {
    expect([...referenceDoc].sort()).toEqual([...REFERENCE_SCREENSHOT_TYPES].sort());
  });

  test('the agent-judged set equals the schema types minus both CLI-decided sets', () => {
    const want = SCHEMA_TYPES.filter(
      (t) => !MECHANICAL_TYPES.has(t) && !REFERENCE_SCREENSHOT_TYPES.has(t)
    );
    expect([...agentDoc].sort()).toEqual([...want].sort());
  });
});
