'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { safeDir, openWorkspaceFile } = require('../workspace/safe-fs');

// Atomic write: stream into a hidden temp file in the same directory,
// fsync, then rename over the target. rename(2) within one dir is atomic, so
// a concurrent reader or a crash sees the old-complete or new-complete file,
// never a truncated one. On any failure the temp file is cleaned up.
//
// rename replaces whatever sits at `file`, a symlink included, so a planted
// link leaf is replaced, never written through. The temp file is created
// O_EXCL|O_NOFOLLOW under a random name, so it cannot be pre-planted either
// (#345). With a projectRoot the target's directory is walked by safe-fs
// (symlink-free, owned by us, created when missing) and the temp file is
// opened through it; without one (paths the user chose, such as junit --out)
// the directory is created as before.
function atomicWrite(file, contents, { projectRoot } = {}) {
  const { O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW } = fs.constants;
  const dir = path.dirname(file);
  if (projectRoot) safeDir(projectRoot, dir, { create: true });
  else fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(file)}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}`
  );
  // Outside the cleanup below: when this open fails nothing of ours exists at
  // `tmp`, so there is nothing to unlink.
  let fd = projectRoot
    ? openWorkspaceFile(projectRoot, tmp, O_WRONLY | O_CREAT | O_EXCL)
    : fs.openSync(tmp, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o666);
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

module.exports = { atomicWrite };
