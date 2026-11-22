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
// The walk only reads: `fs.existsSync` for the markers, then (#346) lstat/fstat
// through safe-fs on the workspace it is about to adopt. `{ fs, getuid, env }`
// are injectable so the walk's termination and the owner check can be tested
// without a real filesystem root or a second uid.

const fsConstants = require('fs').constants;
const path = require('path');

const { fail } = require('../output/envelope');

const { WORKSPACE_DIRNAME, LEGACY_WORKSPACE_DIRNAME, workspaceDir } = require('./layout');
const { UnsafePathError, safeDir, openWorkspaceFile } = require('./safe-fs');

// The MARKER is `.mobile-automator/config.json`, not a bare `.mobile-automator/`
// directory: `mauto setup` always writes config.json, so a real workspace
// always carries it, and an unrelated directory that merely shares the name
// does not count. (The marker used to also guard against this repository's own
// clone folder, `mobile-automator`; that collision cannot happen with a dotted
// name.)
function markerPath(dir) {
  return path.join(dir, WORKSPACE_DIRNAME, 'config.json');
}

// The pre-rename workspace marker. Only ever probed with existsSync: mauto
// never reads, moves or writes inside the legacy folder, it just tells the user
// where it is so they can `mv` it themselves.
function legacyMarkerPath(dir) {
  return path.join(dir, LEGACY_WORKSPACE_DIRNAME, 'config.json');
}

// The fs codes that let discovery adopt a workspace it could not finish
// vetting: the marker raced away after existsSync saw it (ENOENT), or a
// directory or the marker is unreadable (EACCES, EPERM). None of them is a
// planted path, and the verb's own safe-fs read reports the real problem.
const ADOPT_UNVETTED_CODES = new Set(['ENOENT', 'EACCES', 'EPERM']);

// Is the workspace at `dir` safe to adopt? `{ adopt: true }` when it is (or
// could not be vetted for one of the reasons above); `{ adopt: false, unsafe }`
// with the refusal when it is not. Any other error (EMFILE, a bug) propagates:
// discovery never reads an unknown failure as "safe".
function vetWorkspace(dir, deps) {
  try {
    safeDir(dir, workspaceDir(dir), {}, deps);
    const fd = openWorkspaceFile(dir, markerPath(dir), fsConstants.O_RDONLY, 0o666, deps);
    deps.fs.closeSync(fd);
  } catch (err) {
    if (err instanceof UnsafePathError) return { adopt: false, unsafe: err };
    if (err && ADOPT_UNVETTED_CODES.has(err.code)) return { adopt: true };
    throw err;
  }
  return { adopt: true };
}

// Walk up from `startDir` and say what it found, as one of four outcomes told
// apart by `kind` (every consumer switches on it, so a new outcome cannot be
// silently read as another):
//
//   { kind: 'found',  root, searched }     the nearest workspace, vetted
//   { kind: 'legacy', dir, searched }      `dir` holds a pre-rename workspace
//   { kind: 'unsafe', refusal, searched }  the nearest workspace was refused
//   { kind: 'none',   searched }           no workspace up to the boundary
//
// `searched` lists every directory checked, in order, so a caller that finds
// nothing can tell the user exactly where it looked.
//
// The walk stops AFTER checking a directory that contains `.git` (a directory,
// or a file — worktrees and submodules have a `.git` file). A workspace belongs
// to a project, and a project does not extend past its repository: without the
// boundary, a nested checkout with no workspace of its own would silently
// adopt whichever unrelated workspace happens to sit above it. The check is
// inclusive — a workspace at the repository root is the common case.
//
// The walk stops at the first directory holding EITHER marker, so the nearest
// workspace wins whichever name it uses — as it did before the rename. In that
// directory the new marker wins over a legacy one beside it (the user is
// mid-recovery). A legacy-only directory ends the walk as `legacy`: carrying
// on to a new workspace further up would silently run every verb against the
// ancestor's state while the project's own is left behind.
//
// A directory that HAS the marker is vetted before it is adopted (#346): a
// checked-in `.mobile-automator/` can be a symlink, owned by someone else or
// world-writable, and adopting it would hand every verb (and the session
// socket under it) to whoever planted it. The vetting is safe-fs's, not a copy:
// the directory walk, then a read-only open of config.json. An unsafe
// workspace STOPS the walk as `unsafe`, carrying the refusal (an
// UnsafePathError); continuing to a safe ancestor would silently run against
// the wrong project. A race or an unreadable path (ENOENT, EACCES, EPERM)
// adopts it as before: the verb's own read will report the real problem. Any
// other error throws.
function findWorkspaceRoot(startDir, { fs = require('fs'), getuid, env } = {}) {
  const deps = { fs, getuid, env };
  const searched = [];
  let dir = path.resolve(startDir);
  for (;;) {
    searched.push(dir);
    if (fs.existsSync(markerPath(dir))) {
      const vetted = vetWorkspace(dir, deps);
      if (!vetted.adopt) return { kind: 'unsafe', refusal: vetted.unsafe, searched };
      return { kind: 'found', root: dir, searched };
    }
    if (fs.existsSync(legacyMarkerPath(dir))) return { kind: 'legacy', dir, searched };
    if (fs.existsSync(path.join(dir, '.git'))) break;
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  return { kind: 'none', searched };
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

// The workspace directory was renamed to a hidden one. There is no migration
// code: the fix is a one-line `mv`, but the old daemon must be stopped first
// (`mauto session end` would itself look for the new directory and fail) and a
// stray new directory removed so `mv` renames instead of nesting.
function legacyWorkspaceFailure(dir) {
  return {
    envelope: fail(
      'environment',
      `found legacy workspace ${dir}/${LEGACY_WORKSPACE_DIRNAME}/ — the workspace directory is now ${WORKSPACE_DIRNAME}/`,
      `In ${dir}: stop any daemon the old version left running (pkill -f mauto-session-daemon), delete ${WORKSPACE_DIRNAME}/ if it already exists, then run mv ${LEGACY_WORKSPACE_DIRNAME} ${WORKSPACE_DIRNAME} — before any other mauto verb.`
    ),
    exitKind: 'environment',
  };
}

// The failure for a `findWorkspaceRoot` result that is not `found`, for a verb
// that cannot work without a workspace. Which failure each outcome gets is
// policy owned here, so callers hand over the whole result instead of choosing.
// A `found` result is a caller bug: there is nothing to fail.
function workspaceFailure(workspace) {
  switch (workspace.kind) {
    case 'unsafe':
      return {
        envelope: fail('environment', workspace.refusal.message, workspace.refusal.hint),
        exitKind: 'environment',
      };
    case 'legacy':
      return legacyWorkspaceFailure(workspace.dir);
    case 'none':
      return noWorkspaceFailure(workspace.searched);
    default:
      throw new Error(`workspaceFailure: no failure for a "${workspace.kind}" workspace`);
  }
}

module.exports = {
  findWorkspaceRoot,
  workspaceFailure,
  legacyWorkspaceFailure,
  // noWorkspaceFailure is exported for its own unit tests only; verbs go
  // through workspaceFailure.
  noWorkspaceFailure,
};
