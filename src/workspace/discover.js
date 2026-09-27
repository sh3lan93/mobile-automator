'use strict';

// Upward workspace discovery (#188).
//
// Every neighbouring tool a developer runs inside a repo — git, npm, cargo —
// walks up from cwd to find its root. mauto used to join `<cwd>/mobile-automator`
// and stop, so from any subdirectory it reported a confident, well-formed answer
// about an empty workspace (`config get` with the value silently absent, an
// empty memory store). This module is the walk; src/cli.js decides what each
// verb does with its answer.
//
// Pure apart from `fs.existsSync`, which is injectable so the walk's
// termination can be tested without a real filesystem root.

const path = require('path');

const { fail } = require('../output/envelope');

const WORKSPACE_DIRNAME = 'mobile-automator';

// The MARKER is `mobile-automator/config.json`, not a bare `mobile-automator/`
// directory. This repository is itself usually cloned into a folder named
// `mobile-automator`, so a bare-directory check would make every checkout's
// parent look like a workspace. `mauto setup` always writes config.json, so a
// real workspace always carries it.
function markerPath(dir) {
  return path.join(dir, WORKSPACE_DIRNAME, 'config.json');
}

// Walk up from `startDir` and return the NEAREST directory holding a workspace.
// `searched` lists every directory checked, in order, so a caller that finds
// nothing can tell the user exactly where it looked.
//
// The walk stops AFTER checking a directory that contains `.git` (a directory,
// or a file — worktrees and submodules have a `.git` file). A workspace belongs
// to a project, and a project does not extend past its repository: without the
// boundary, a nested checkout with no workspace of its own would silently
// adopt whichever unrelated workspace happens to sit above it. The check is
// inclusive — a workspace at the repository root is the common case.
function findWorkspaceRoot(startDir, { fs = require('fs') } = {}) {
  const searched = [];
  let dir = path.resolve(startDir);
  for (;;) {
    searched.push(dir);
    if (fs.existsSync(markerPath(dir))) return { root: dir, searched };
    if (fs.existsSync(path.join(dir, '.git'))) break;
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  return { root: null, searched };
}

// The honest answer when discovery found nothing, for a verb that cannot work
// without a workspace. `environment` (exit 5), matching the CLI's other
// fixable-by-the-caller faults: an agent reading `ok:true` with a missing value
// cannot tell "unset" from "wrong directory", so this must not be a success.
function noWorkspaceFailure(searched) {
  return {
    envelope: fail(
      'environment',
      `no ${WORKSPACE_DIRNAME}/ workspace found (looked for ${WORKSPACE_DIRNAME}/config.json)`,
      `Searched: ${searched.join(', ')}. Run \`mauto setup\` from your project root, or cd into the project that has one.`
    ),
    exitKind: 'environment',
  };
}

module.exports = { findWorkspaceRoot, noWorkspaceFailure, markerPath, WORKSPACE_DIRNAME };
