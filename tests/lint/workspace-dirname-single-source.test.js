'use strict';

// The workspace directory name is spelled in exactly one place:
// src/workspace/dirname.js. Ten call sites used to hard-code it, so renaming
// the directory meant finding all ten by grep and trusting nobody added an
// eleventh. This guard makes the eleventh fail the build instead.
//
// Comments are stripped before matching: prose may say `mobile-automator/`
// freely, only a string literal that could become a path is an offence.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OWNER = 'src/workspace/dirname.js';

// A quoted/backticked literal that begins with the directory name and either
// ends there or continues into a path. `'mobile-automator-execute'` and URLs
// (the name is not at the start of the literal) do not match.
const LITERAL = /['"`]\.?mobile-automator(?:['"`]|\/)/;

// Blank out comments but keep newlines so reported line numbers stay true.
// A `//` inside a string (https://...) must not start a comment, so strings
// are consumed first.
function stripComments(source) {
  return source.replace(
    /('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (match, str) => (str !== undefined ? str : match.replace(/[^\n]/g, ' ')),
  );
}

function offendingLines(source) {
  return stripComments(source)
    .split('\n')
    .map((text, i) => ({ line: i + 1, text }))
    .filter(({ text }) => LITERAL.test(text))
    .map(({ line }) => line);
}

function trackedSources() {
  return execFileSync('git', ['ls-files', '--', 'src', 'bin'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(js|mjs)$/.test(f) && f !== OWNER);
}

describe('workspace directory name has a single source', () => {
  test('no file other than dirname.js spells the workspace directory name', () => {
    const offenders = [];
    for (const file of trackedSources()) {
      const source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      for (const line of offendingLines(source)) offenders.push(`${file}:${line}`);
    }
    expect(offenders).toEqual([]);
  });

  test('the matcher', () => {
    expect(offendingLines("path.join(root, 'mobile-automator')")).toHaveLength(1);
    expect(offendingLines('".mobile-automator"')).toHaveLength(1);
    expect(offendingLines('`mobile-automator/results`')).toHaveLength(1);
    expect(offendingLines("'mobile-automator-execute'")).toEqual([]);
    expect(offendingLines("'https://github.com/sh3lan93/mobile-automator'")).toEqual([]);
    expect(offendingLines('// mobile-automator/ tree')).toEqual([]);
    expect(offendingLines('/* \'mobile-automator\' */')).toEqual([]);
    expect(offendingLines('path.join(root, WORKSPACE_DIRNAME)')).toEqual([]);
  });

  test('dirname.js holds both names', () => {
    expect(require('../../src/workspace/dirname')).toEqual({
      WORKSPACE_DIRNAME: '.mobile-automator',
      LEGACY_WORKSPACE_DIRNAME: 'mobile-automator',
    });
  });
});
