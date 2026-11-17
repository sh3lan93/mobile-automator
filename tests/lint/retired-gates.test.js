'use strict';

// A multi-PR feature ships behind an opt-in env var (gate-then-graduate), and
// its graduation PR deletes the gate. A graduated feature that still reads
// the variable has a hidden second behaviour nobody tests, which is the exact
// failure the gate existed to prevent — just moved to the other side of the
// release. Each retired gate is one row here; graduating the next feature adds
// a row, not another guard file.
//
// The scan is every file git knows (tests/lint/docs-corpus.js `repoFiles`):
// source, tests, scripts, workflows and docs alike, so a leftover
// `env: { <gate>: '1' }` in a workflow or harness is caught too. Historical
// records (CHANGELOG.md, docs/changelog.md, docs/plans/**) are excluded: they
// say what was true when they were written.

const fs = require('fs');
const path = require('path');

const { REPO_ROOT, isHistorical, repoFiles } = require('./docs-corpus');

const RETIRED_GATES = [
  // Observability, graduated in 0.26.0.
  { name: 'MAUTO_OBSERVE', removed: [] },
  // Replay (`mauto run`, PRD #271), graduated in 0.40.0 (#284).
  { name: 'MAUTO_REPLAY', removed: ['src/run/gate.js'] },
];

// This file names every gate it scans for.
const SELF = path.relative(REPO_ROOT, __filename).split(path.sep).join('/');

describe('retired feature gates stay retired', () => {
  const files = repoFiles()
    .filter((rel) => rel !== SELF && !isHistorical(rel))
    // A tracked file deleted in the working tree is still listed by git.
    .filter((rel) => fs.existsSync(path.join(REPO_ROOT, rel)))
    .map((rel) => [rel, fs.readFileSync(path.join(REPO_ROOT, rel), 'latin1')]);

  test('the scan covers source, tests, workflows and docs (the guard is not vacuous)', () => {
    const scanned = new Set(files.map(([rel]) => rel));
    for (const rel of ['src/cli.js', 'tests/lint/docs-corpus.js', '.github/workflows/test.yml', 'README.md', 'docs/faq.md']) {
      expect(scanned).toContain(rel);
    }
  });

  describe.each(RETIRED_GATES)('$name', ({ name, removed }) => {
    test('is named in no file outside the historical records', () => {
      expect(files.filter(([, text]) => text.includes(name)).map(([rel]) => rel)).toEqual([]);
    });

    test('the files that implemented the gate stay deleted', () => {
      expect(removed.filter((rel) => fs.existsSync(path.join(REPO_ROOT, rel)))).toEqual([]);
    });
  });
});
