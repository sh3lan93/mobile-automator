'use strict';

// The workspace directory is named and located in exactly one place:
// src/workspace/layout.js. Ten call sites used to hard-code the name, so
// renaming the directory meant finding all ten by grep and trusting nobody
// added an eleventh. Two rules make the eleventh fail the build:
//
//  1. Nothing outside src/workspace/ references WORKSPACE_DIRNAME or
//     LEGACY_WORKSPACE_DIRNAME. A site that imports the name rebuilds the path
//     itself (and its own copy of the join); the workspace PATH is owned by
//     workspaceDir(), so callers take that and join their own subpath.
//  2. No string literal spells the directory name, which is what stops a
//     bypassing `path.join(root, '.mobile-automator')`.
//
// Comments are stripped before matching: prose may say `mobile-automator/`
// freely, only code that could become a path is an offence.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OWNER_DIR = 'src/workspace/';

// A quoted/backticked literal that begins with the directory name and either
// ends there or continues into a path. `'mobile-automator-execute'` and URLs
// (the name is not at the start of the literal) do not match.
const LITERAL = /['"`]\.?mobile-automator(?:['"`]|\/)/;
const CONSTANT = /\b(?:LEGACY_)?WORKSPACE_DIRNAME\b/;

// Blank out comments but keep newlines so reported line numbers stay true.
// A `//` inside a string (https://...) must not start a comment, so strings
// are consumed first.
function stripComments(source) {
  return source.replace(
    /('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (match, str) => (str !== undefined ? str : match.replace(/[^\n]/g, ' ')),
  );
}

function offendingLines(source, pattern) {
  return stripComments(source)
    .split('\n')
    .map((text, i) => ({ line: i + 1, text }))
    .filter(({ text }) => pattern.test(text))
    .map(({ line }) => line);
}

function trackedSources() {
  return execFileSync('git', ['ls-files', '--', 'src', 'bin'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(js|mjs)$/.test(f) && !f.startsWith(OWNER_DIR));
}

function scan(pattern) {
  const offenders = [];
  for (const file of trackedSources()) {
    const source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
    for (const line of offendingLines(source, pattern)) offenders.push(`${file}:${line}`);
  }
  return offenders;
}

describe('workspace directory has a single source', () => {
  test('nothing outside src/workspace/ references the directory-name constants', () => {
    expect(scan(CONSTANT)).toEqual([]);
  });

  test('nothing outside src/workspace/ spells the directory name as a literal', () => {
    expect(scan(LITERAL)).toEqual([]);
  });

  test('the literal matcher', () => {
    expect(offendingLines("path.join(root, 'mobile-automator')", LITERAL)).toHaveLength(1);
    expect(offendingLines('".mobile-automator"', LITERAL)).toHaveLength(1);
    expect(offendingLines('`mobile-automator/results`', LITERAL)).toHaveLength(1);
    expect(offendingLines("'mobile-automator-execute'", LITERAL)).toEqual([]);
    expect(offendingLines("'https://github.com/sh3lan93/mobile-automator'", LITERAL)).toEqual([]);
    expect(offendingLines('// mobile-automator/ tree', LITERAL)).toEqual([]);
    expect(offendingLines("/* 'mobile-automator' */", LITERAL)).toEqual([]);
    expect(offendingLines('workspaceDir(root)', LITERAL)).toEqual([]);
  });

  test('the constant matcher', () => {
    expect(offendingLines('path.join(root, WORKSPACE_DIRNAME)', CONSTANT)).toHaveLength(1);
    expect(offendingLines('const { LEGACY_WORKSPACE_DIRNAME } = x', CONSTANT)).toHaveLength(1);
    expect(offendingLines('// WORKSPACE_DIRNAME is the name', CONSTANT)).toEqual([]);
    expect(offendingLines('workspaceDir(root)', CONSTANT)).toEqual([]);
  });

  test('layout.js holds both names and the path helper', () => {
    const layout = require('../../src/workspace/layout');
    expect(layout.WORKSPACE_DIRNAME).toBe('.mobile-automator');
    expect(layout.LEGACY_WORKSPACE_DIRNAME).toBe('mobile-automator');
    expect(layout.workspaceDir('/proj')).toBe(path.join('/proj', '.mobile-automator'));
    expect(Object.keys(layout).sort()).toEqual(
      ['LEGACY_WORKSPACE_DIRNAME', 'WORKSPACE_DIRNAME', 'workspaceDir'],
    );
  });
});
