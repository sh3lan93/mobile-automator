'use strict';

const fs = require('fs');
const path = require('path');

// Atomic write: stream into a hidden temp file in the same directory,
// fsync, then rename over the target. rename(2) within one dir is atomic, so
// a concurrent reader or a crash sees the old-complete or new-complete file,
// never a truncated one. On any failure the temp file is cleaned up.
function atomicWrite(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.tmp.${process.pid}.${Date.now()}`
  );
  let fd;
  try {
    fd = fs.openSync(tmp, 'w');
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
