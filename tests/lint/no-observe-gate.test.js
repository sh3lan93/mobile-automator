'use strict';

// The observability feature graduated in 0.26.0. MAUTO_OBSERVE was the
// gate-then-graduate env var that kept slices 2-4's partial states invisible on
// main; a graduated feature that still reads it has a hidden second behaviour
// nobody tests, which is the exact failure the gate existed to prevent — just
// moved to the other side of the release.
//
// docs/plans/** is excluded on purpose: those are historical records of what
// was true when they were written, the same exclusion tests/lint/docs-counts
// .test.js makes and for the same reason.

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const ROOTS = ['src', 'bin', 'tests', 'docs/reference', 'docs/guides', 'docs/concepts'];
const FILES = ['README.md', 'TROUBLESHOOTING.md', 'CLAUDE.md'];
// This guard's own filename, so its prose describing the string it scans for
// cannot flag itself.
const SELF = __filename;

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

describe('the MAUTO_OBSERVE gate is gone', () => {
  it('appears in no shipping source, test or doc', () => {
    const candidates = [
      ...ROOTS.flatMap((r) => walk(path.join(REPO, r))),
      ...FILES.map((f) => path.join(REPO, f)).filter((f) => fs.existsSync(f)),
    ];
    const offenders = candidates
      .filter((f) => f !== SELF)
      .filter((f) => fs.readFileSync(f, 'utf8').includes('MAUTO_OBSERVE'))
      .map((f) => path.relative(REPO, f));
    expect(offenders).toEqual([]);
  });
});
