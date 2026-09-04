'use strict';

const fs = require('fs');
const path = require('path');

const scenarioSchema = require('../../src/schemas/scenario_schema.json');
const { ACTION_CATALOG } = require('../../src/device/action-catalog');

// Hand-maintained capability counts in prose drift the moment the schema grows.
// They already did once: #117 wired 7 stranded mobile-mcp primitives into flat
// verbs and every doc kept saying "14 action types" (issue #167), which
// understated the surface by four and led an audit astray. This guard derives
// the true counts from the schema + action catalog and fails any shipping doc
// that states a different number, so a count can never silently rot again.
//
// The doc corpus — and which docs count as historical, since "14 actions" was
// TRUE when those changelog entries were written — comes from ./docs-corpus,
// shared with every other prose-scanning guard.

const { REPO_ROOT, shippingDocs } = require('./docs-corpus');

// --- Derived truth (never hardcode these) ---------------------------------

const STEP_ACTIONS = scenarioSchema.definitions.step.properties.action.enum;
const PRECONDITION_ACTIONS =
  scenarioSchema.properties.preconditions.properties.device_actions.items.properties.action.enum;
const ASSERTION_TYPES = scenarioSchema.definitions.assertion.properties.type.enum;

const SEMANTIC_ACTIONS = Object.entries(ACTION_CATALOG)
  .filter(([, entry]) => entry.resolution === 'semantic')
  .map(([action]) => action);

const COUNTS = {
  // Every value a step's `action` field may take (core + semantic).
  stepActions: STEP_ACTIONS.length,
  // The subset documented as numbered entries in docs/reference/schema.md,
  // i.e. everything except the platform-agnostic semantic actions.
  coreActions: STEP_ACTIONS.length - SEMANTIC_ACTIONS.length,
  assertionTypes: ASSERTION_TYPES.length,
  // The catalog covers the union of both action enums (clear_app_data is in
  // both), which is why it is not simply the sum.
  catalogEntries: new Set([...STEP_ACTIONS, ...PRECONDITION_ACTIONS]).size,
};

// --- Claims found in prose, and the count each must equal ------------------

const CLAIM_PATTERNS = [
  {
    name: '"N action types"',
    regex: /(\d+)\s+action types/gi,
    expected: () => COUNTS.stepActions,
  },
  {
    name: '"Action Types (N total)" heading',
    regex: /Action Types \((\d+) total\)/gi,
    expected: () => COUNTS.stepActions,
  },
  {
    name: '"N core actions"',
    regex: /(\d+)\s+core actions/gi,
    expected: () => COUNTS.coreActions,
  },
  {
    name: '"N assertion types"',
    regex: /(\d+)\s+assertion types/gi,
    expected: () => COUNTS.assertionTypes,
  },
];

describe('shipping docs state capability counts that match the schema', () => {
  const files = shippingDocs();

  it('finds docs to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const { name, regex, expected } of CLAIM_PATTERNS) {
    it(`every ${name} claim equals the derived count`, () => {
      const want = expected();
      const offenders = [];

      for (const rel of files) {
        const lines = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').split('\n');
        lines.forEach((line, i) => {
          for (const m of line.matchAll(regex)) {
            if (Number(m[1]) !== want) {
              offenders.push(
                `${rel}:${i + 1}: says ${m[1]}, schema says ${want} — ${line.trim()}`
              );
            }
          }
        });
      }

      expect(offenders).toEqual([]);
    });
  }

  it('the action catalog covers every action in both schema enums', () => {
    const union = [...new Set([...STEP_ACTIONS, ...PRECONDITION_ACTIONS])];
    const missing = union.filter((a) => !ACTION_CATALOG[a]);
    expect(missing).toEqual([]);
    expect(Object.keys(ACTION_CATALOG).length).toBe(COUNTS.catalogEntries);
  });
});
