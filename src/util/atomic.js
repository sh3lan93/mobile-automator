'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { createWorkspaceFile, openLeaf } = require('../workspace/safe-fs');

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
// Two writers, one path each, sharing the core below:
//   - atomicWorkspaceWrite confines the write to .mobile-automator/: the temp
//     file is created by safe-fs's createWorkspaceFile, which walks the
//     target's directory (symlink-free, owned by us, created when missing).
//   - atomicWrite does NOT confine: it is for paths the user chose (junit
//     --out) and creates the directory with a plain recursive mkdir. Any write
//     into the workspace belongs in atomicWorkspaceWrite.

// `openTmp(tmp)` creates the temp file exclusively and returns its fd.
function writeViaTemp(file, contents, openTmp) {
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}`
  );
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

function atomicWorkspaceWrite(projectRoot, file, contents) {
  // Positional, so a call that forgot the root shifts every argument left:
  // `contents` is then missing, which is what catches it.
  if (typeof projectRoot !== 'string' || typeof file !== 'string' || contents === undefined) {
    throw new TypeError('atomicWorkspaceWrite(projectRoot, file, contents) needs the project root and the file');
  }
  // createWorkspaceFile walks (and creates) the temp file's directory, which is
  // the target's: the rename stays inside the directory it checked.
  writeViaTemp(file, contents, (tmp) => createWorkspaceFile(projectRoot, tmp));
}

function atomicWrite(file, contents) {
  const { O_WRONLY, O_CREAT, O_EXCL } = fs.constants;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeViaTemp(file, contents, (tmp) => openLeaf(tmp, O_WRONLY | O_CREAT | O_EXCL).fd);
}

module.exports = { atomicWrite, atomicWorkspaceWrite };
