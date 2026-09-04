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
// The doc corpus, and which docs are historical records exempt from this scan,
// come from ./docs-corpus, shared with every other prose-scanning guard. When
// that corpus replaced this file's hand-picked file list it immediately found a
// stale `/mobile-automator:*` in sample-app/README.md that had been sitting
// outside the old list's reach since the extension was removed.
//
// Note: `.gemini/skills` (without `.archive`) is NOT banned — it is the valid
// skills dir for the Gemini host (`mauto init --agent gemini`). Only the
// recorder's `.archive` variant is stale.

const { REPO_ROOT, shippingDocs } = require('./docs-corpus');

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

describe('shipping docs name no removed Gemini-extension model', () => {
  const files = shippingDocs();

  it('finds docs to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const { name, regex } of STALE_PATTERNS) {
    it(`no doc contains ${name}`, () => {
      const offenders = [];
      for (const rel of files) {
        const lines = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').split('\n');
        lines.forEach((line, i) => {
          if (regex.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
      }
      expect(offenders).toEqual([]);
    });
  }
});
