'use strict';

// The agent-free floor of the shipped scenario corpus (#281, replay slice R5b).
//
// An assertion is decided without an agent when its type is in MECHANICAL_TYPES
// (decided over the element list) or REFERENCE_SCREENSHOT_TYPES (decided by a
// pixel diff against a reference screenshot, assuming its baseline is present).
// Everything else returns needs_agent. This is a pure static count over the
// corpus: no device, no bridge.
//
// The floors pin the HONEST measured values, rounded down, so a change that
// moves an assertion type back to the agent (or a corpus edit that adds
// agent-judged assertions) fails here and has to be a deliberate edit.
//
// Measured when written: 59 of 68 assertions (86.8%), 5 of 12 scenarios fully
// agent-free (41.7%). The PRD's R5b floor of >= 96% is not reachable on this
// corpus: it contains no screenshot_match assertion, so R5b cannot move the
// number. Even with R5a's five planned promotions to MECHANICAL_TYPES it would
// be 65/68 (95.6%). R5a (#276) promoted three (element_fully_visible,
// screen_title, permission_dialog_shown; alert_present / alert_text stay with
// the agent): 63 of 68 (92.6%), 8 of 12 scenarios (66.7%). Raise these floors
// when the measured value rises; never lower them to make a change pass.

const { MECHANICAL_TYPES, REFERENCE_SCREENSHOT_TYPES } = require('../../../src/assertion/evaluator');
const { loadCorpus, CORPUS_SIZE } = require('../../helpers/scenario-corpus');

const ASSERTION_FLOOR = 0.92;
const SCENARIO_FLOOR = 0.66;

const decidedWithoutAgent = (a) => MECHANICAL_TYPES.has(a.type) || REFERENCE_SCREENSHOT_TYPES.has(a.type);

describe('scenario corpus agent-free floor', () => {
  const corpus = loadCorpus();
  const assertions = corpus.flatMap(([, s]) => s.assertions || []);

  test(`reads the full corpus (${CORPUS_SIZE} scenarios, with assertions)`, () => {
    expect(corpus).toHaveLength(CORPUS_SIZE);
    expect(assertions.length).toBeGreaterThan(0);
  });

  test(`at least ${ASSERTION_FLOOR} of assertions are decided without an agent`, () => {
    const share = assertions.filter(decidedWithoutAgent).length / assertions.length;
    expect(share).toBeGreaterThanOrEqual(ASSERTION_FLOOR);
  });

  test(`at least ${SCENARIO_FLOOR} of scenarios are fully agent-free`, () => {
    const free = corpus.filter(([, s]) => (s.assertions || []).every(decidedWithoutAgent)).length;
    expect(free / corpus.length).toBeGreaterThanOrEqual(SCENARIO_FLOOR);
  });
});
