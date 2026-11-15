'use strict';

// The shipped scenario corpus (#272): every JSON scenario in the example docs
// plus the sample-app scenarios the real-device E2E replays. Shared by the
// corpus validity test and the agent-free floor so both read the same set.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const EXAMPLE_DOCS = ['docs/examples/android.md', 'docs/examples/ios.md'];
const SAMPLE_DIR = 'sample-app/scenarios';
// Pinned so a scenario that stops parsing (or a moved file) fails instead of
// silently shrinking the corpus.
const CORPUS_SIZE = 12;

// Returns [label, scenario] pairs.
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

module.exports = { loadCorpus, CORPUS_SIZE };
