'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { createProjectFile, createWorkspaceFile, openUserLeaf, userFile } = require('../workspace/safe-fs');

// Atomic write: stream into a hidden temp file in the same directory,
// fsync, then rename over the target. rename(2) within one dir is atomic, so
// a concurrent reader or a crash sees the old-complete or new-complete file,
// never a truncated one. On any failure the temp file is cleaned up.
//
// rename replaces whatever sits at `file`, a symlink included, so a planted
// link leaf is replaced, never written through. The temp file is created
// O_EXCL|O_NOFOLLOW under a random name, so it cannot be pre-planted either
// (#345).
//
// Four writers, sharing the core below. Pick by who chose the path:
//   - atomicWorkspaceWrite: mauto's own files in .mobile-automator/. The temp
//     file is created by safe-fs's createWorkspaceFile, which walks the
//     target's directory (symlink-free, owned by us, created when missing).
//   - atomicProjectWrite: mauto's own files elsewhere in the project (the host
//     files `mauto init` writes). Same walk, bounded by the project root, via
//     createProjectFile (#347).
//   - atomicOutputWrite: a path the user chose (`result export --out`,
//     `run --junit`). safe-fs's userFile decides by scope: in the workspace
//     confined like atomicWorkspaceWrite (#347); elsewhere in the project the
//     same walk bounded by the project root, like atomicProjectWrite, so a
//     committed `reports` link is refused, never written through (#362);
//     outside the project written unconfined (a plain recursive mkdir): an
//     explicit path there is the user's call. There is no exported unconfined
//     writer, so no write can skip that decision.
//   - atomicUserLeafWrite: mauto's own file outside every project (the
//     per-user telemetry consent record), in a directory the caller settled
//     itself. No project root and no walk: the temp file is opened through
//     safe-fs's openUserLeaf (O_NOFOLLOW, ours, one link), the leaf rule #359
//     set for a path outside any project, and created with `mode`.

// The one temp-file name for a write that lands at `file`: a hidden sibling in
// the same directory (so a rename or link to `file` never crosses a
// filesystem), unique per process and call. Unguessable, but callers still
// create it exclusively: the name alone is no defence against a planted entry.
// Also used by device/session-salt.js, which link(2)s rather than renames.
function tempPathFor(file) {
  return path.join(
    path.dirname(file),
    `.${path.basename(file)}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}`
  );
}

// `openTmp(tmp)` creates the temp file exclusively and returns its fd.
function writeViaTemp(file, contents, openTmp) {
  const tmp = tempPathFor(file);
  // Outside the cleanup below: when this open fails nothing of ours exists at
  // `tmp`, so there is nothing to unlink.
  let fd = openTmp(tmp);
  try {
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, file);
  } catch (e) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch (_) {
        /* ignore */
      }
    }
    try {
      fs.unlinkSync(tmp);
    } catch (_) {
      /* ignore */
    }
    throw e;
  }
}

// The rooted writers take the root positionally, so a call that forgot it
// shifts every argument left: `contents` is then missing, which is what
// catches it.
function requireRoot(name, projectRoot, file, contents) {
  if (typeof projectRoot !== 'string' || typeof file !== 'string' || contents === undefined) {
    throw new TypeError(`${name}(projectRoot, file, contents) needs the project root and the file`);
  }
}

function atomicWorkspaceWrite(projectRoot, file, contents) {
  requireRoot('atomicWorkspaceWrite', projectRoot, file, contents);
  // createWorkspaceFile walks (and creates) the temp file's directory, which is
  // the target's: the rename stays inside the directory it checked.
  writeViaTemp(file, contents, (tmp) => createWorkspaceFile(projectRoot, tmp));
}

function atomicProjectWrite(projectRoot, file, contents) {
  requireRoot('atomicProjectWrite', projectRoot, file, contents);
  writeViaTemp(file, contents, (tmp) => createProjectFile(projectRoot, tmp));
}

function atomicOutputWrite(projectRoot, file, contents) {
  requireRoot('atomicOutputWrite', projectRoot, file, contents);
  const { O_WRONLY, O_CREAT, O_EXCL } = fs.constants;
  // target.path, not `file`: through an aliased root they differ, and the
  // rename must use the path the open checked.
  const target = userFile(projectRoot, file);
  writeViaTemp(target.path, contents, (tmp) => target.open(tmp, O_WRONLY | O_CREAT | O_EXCL));
}

// `mode` is the temp file's creation mode, and so the file's: the rename
// moves that inode into place, and umask can only remove bits, so a 0o600
// write is never readable by others, not even before a chmod could run.
function atomicUserLeafWrite(file, contents, { mode = 0o666 } = {}) {
  if (typeof file !== 'string' || contents === undefined) {
    throw new TypeError('atomicUserLeafWrite(file, contents) needs the file and its contents');
  }
  const { O_WRONLY, O_CREAT, O_EXCL } = fs.constants;
  writeViaTemp(file, contents, (tmp) => openUserLeaf(tmp, O_WRONLY | O_CREAT | O_EXCL, mode));
}

module.exports = { atomicWorkspaceWrite, atomicProjectWrite, atomicOutputWrite, atomicUserLeafWrite, tempPathFor };
