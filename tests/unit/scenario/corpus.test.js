'use strict';

// The shipped scenario corpus (#272): every JSON scenario in the example docs
// plus the sample-app scenarios the real-device E2E replays. They must stay
// schema-valid with zero blocking replay findings, because run-e2e.mjs runs
// `mauto validate --strict` on each before it touches the device.

const fs = require('fs');
const path = require('path');
const { ScenarioValidator } = require('../../../src/scenario/validator');
const { findReplayWarnings, summarize } = require('../../../src/scenario/replayability');

const ROOT = path.resolve(__dirname, '../../..');
const EXAMPLE_DOCS = ['docs/examples/android.md', 'docs/examples/ios.md'];
const SAMPLE_DIR = 'sample-app/scenarios';
// Pinned so a scenario that stops parsing (or a moved file) fails here
// instead of silently shrinking the corpus.
const CORPUS_SIZE = 12;

function loadCorpus() {
  const corpus = [];
  for (const rel of EXAMPLE_DOCS) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const m of text.matchAll(/```json\n([\s\S]*?)```/g)) {
      const json = JSON.parse(m[1]);
      if (Array.isArray(json.steps)) corpus.push([`${rel} ${json.scenario_id}`, json]);
    }
  }
  for (const name of fs.readdirSync(path.join(ROOT, SAMPLE_DIR)).filter((f) => f.endsWith('.json'))) {
    const rel = `${SAMPLE_DIR}/${name}`;
    corpus.push([rel, JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))]);
  }
  return corpus;
}

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
