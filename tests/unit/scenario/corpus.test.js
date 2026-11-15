'use strict';

// The shipped scenario corpus (#272): every JSON scenario in the example docs
// plus the sample-app scenarios the real-device E2E replays. They must stay
// schema-valid with zero blocking replay findings, because run-e2e.mjs runs
// `mauto validate --strict` on each before it touches the device.

const { ScenarioValidator } = require('../../../src/scenario/validator');
const { findReplayWarnings, summarize } = require('../../../src/scenario/replayability');
const { loadCorpus, CORPUS_SIZE } = require('../../helpers/scenario-corpus');

const corpus = loadCorpus();
const validator = new ScenarioValidator();

describe('scenario corpus', () => {
  test(`has ${CORPUS_SIZE} scenarios`, () => {
    expect(corpus).toHaveLength(CORPUS_SIZE);
  });

  test.each(corpus)('%s is schema-valid', (_name, scenario) => {
    expect(validator.validate(scenario)).toMatchObject({ valid: true });
  });

  test.each(corpus)('%s has no blocking replay findings', (_name, scenario) => {
    expect(summarize(findReplayWarnings(scenario)).blocking).toEqual([]);
  });
});
