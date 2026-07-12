'use strict';

const fs = require('fs');
const path = require('path');

// The tool is a host-agnostic `mauto` CLI. The Gemini *extension* it grew out of
// is gone (colon slash-commands `/mobile-automator:*`, `gemini extensions
// install/link`, the `setup_state.json` setup-state file, the recorder's
// `.gemini/skills/.archive` restore dir, the `gemini-extension.json` manifest,
// the `${extensionPath}` template variable, the `/skills reload` command).
// Shipping, instructional docs that still teach that removed model send a user
// down steps that cannot work. This guard fails on those stale tokens so the
// docs can no longer drift back. The banned set is every removed-artifact token
// with NO innocent usage in prose; ambiguous tokens (`.toml`, a bare
// `GEMINI.md`) are deliberately left out to stay false-positive-free.
//
// Excluded by design:
//   - changelog files (a changelog is a historical record)
//   - docs/plans/** (point-in-time design docs)
// Note: `.gemini/skills` (without `.archive`) is NOT banned — it is the valid
// skills dir for the Gemini host (`mauto init --agent gemini`). Only the
// recorder's `.archive` variant is stale.

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const STALE_PATTERNS = [
  {
    name: 'colon slash-command syntax `/mobile-automator:` (current form is the hyphen `/mobile-automator-`)',
    regex: /\/mobile-automator:/,
  },
  {
    name: '`gemini extensions` (the extension install/link path is removed)',
    regex: /gemini extensions/,
  },
  {
    name: '`setup_state.json` (removed — workspace config is `mobile-automator/config.json`)',
    regex: /setup_state\.json/,
  },
  {
    name: '`.gemini/skills/.archive` (removed recorder restore dir)',
    regex: /\.gemini\/skills\/\.archive/,
  },
  // The following name removed extension-era artifacts with no innocent usage
  // in prose, so banning them is zero-false-positive. (`.toml` and a bare
  // `GEMINI.md` are deliberately NOT banned — TOML is a normal file format and
  // `GEMINI.md` can appear in a sentence like "we removed GEMINI.md".)
  {
    name: '`gemini-extension.json` (removed extension manifest)',
    regex: /gemini-extension\.json/,
  },
  {
    name: '`extensionPath` / `${extensionPath}` (removed extension template variable)',
    regex: /extensionPath/,
  },
  {
    name: '`/skills reload` (removed Gemini extension command)',
    regex: /\/skills reload/,
  },
];

// Files / directories to skip (relative to repo root, posix separators).
// Point-in-time design docs (brainstorm specs + implementation plans) are a
// historical record of decisions and legitimately describe the removed
// extension-era model; they are excluded like changelogs. They live under
// docs/superpowers/{plans,specs} (the bare docs/plans path is kept for any
// legacy location).
const EXCLUDED = [
  'docs/changelog.md',
  'CHANGELOG.md',
  'docs/plans',
  'docs/superpowers/plans',
  'docs/superpowers/specs',
];

function isExcluded(relPath) {
  const posix = relPath.split(path.sep).join('/');
  return EXCLUDED.some(
    (ex) => posix === ex || posix.startsWith(ex + '/')
  );
}

function collectDocs() {
  const files = [];

  // Top-level shipping docs.
  for (const top of ['TROUBLESHOOTING.md', 'README.md', 'ROADMAP.md', 'CONTRIBUTING.md']) {
    const abs = path.join(REPO_ROOT, top);
    if (fs.existsSync(abs)) files.push(abs);
  }

  // Every markdown file under docs/, minus the exclusions.
  const docsRoot = path.join(REPO_ROOT, 'docs');
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(REPO_ROOT, abs);
      if (isExcluded(rel)) continue;
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(abs);
      }
    }
  };
  if (fs.existsSync(docsRoot)) walk(docsRoot);

  return files;
}

describe('shipping docs name no removed Gemini-extension model', () => {
  const files = collectDocs();

  for (const { name, regex } of STALE_PATTERNS) {
    it(`no doc contains ${name}`, () => {
      const offenders = [];
      for (const abs of files) {
        const lines = fs.readFileSync(abs, 'utf8').split('\n');
        lines.forEach((line, i) => {
          if (regex.test(line)) {
            offenders.push(`${path.relative(REPO_ROOT, abs)}:${i + 1}: ${line.trim()}`);
          }
        });
      }
      expect(offenders).toEqual([]);
    });
  }
});
