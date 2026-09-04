'use strict';

// The shared doc corpus for every prose-scanning lint guard.
//
// Three guards used to answer "which markdown files ship, and which are
// historical?" independently — three directory walks, three exclusion lists,
// and by the time #162 landed the three lists had already diverged (two of them
// still excluded a `docs/superpowers/` tree that no longer exists, and none of
// them looked at `sample-app/`, which was still teaching the removed Gemini
// extension's slash-command syntax). Guards that hand-maintain their own corpus
// are themselves a drift surface, which is precisely what they exist to prevent.

const { execFileSync } = require('child_process');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Historical records. A claim in one of these was TRUE on the date it was
// written and must not be rewritten to match today's truth.
const HISTORICAL = ['CHANGELOG.md', 'docs/changelog.md', 'docs/plans/'];

/**
 * Every markdown file that belongs to the repo, minus historical records, as
 * repo-root-relative posix paths.
 *
 * Enumerated with `git ls-files` rather than a directory walk because git
 * already knows what belongs to the repo: `node_modules`, nested worktrees
 * under `.claude/`, and gitignored scratch space such as `.superpowers/` all
 * drop out for free. A hand-maintained exclusion list has to restate
 * `.gitignore` and then drifts from it.
 *
 * `--cached --others --exclude-standard` is tracked files *plus* files that are
 * not yet staged but would be added by `git add` — so a doc written but not yet
 * committed is still scanned, while ignored paths stay out. Plain `--cached`
 * would let a brand-new doc drift until it was staged. The trade is that local
 * scratch markdown has to be gitignored to stay out of the scan; in CI the two
 * forms are identical, because a fresh checkout has no unstaged files.
 *
 * @returns {string[]}
 */
function shippingDocs() {
  let stdout;
  try {
    stdout = execFileSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.md'],
      { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
    );
  } catch (err) {
    throw new Error(
      `The doc lint guards enumerate their corpus with \`git ls-files\`, which failed in ` +
        `${REPO_ROOT}: ${err.message}`
    );
  }

  const seen = new Set(stdout.split('\0').filter(Boolean));
  return [...seen].filter((rel) => !HISTORICAL.some((h) => rel === h || rel.startsWith(h))).sort();
}

module.exports = { REPO_ROOT, HISTORICAL, shippingDocs };
