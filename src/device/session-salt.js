'use strict';

// The per-workspace salt behind the daemon's argv marker (#236).
//
// `ps` shows every process's argv to every user on the host, so the daemon's
// command line carries HMAC(salt, root) (session-paths.daemonMarkerKey) rather
// than a digest anyone could recompute from a guessed project path. The salt is
// 32 random bytes as hex in <root>/.mobile-automator/.session/marker.salt, mode
// 0600 so only the workspace's owner can read it. It is created once and never
// rotated: rotating it would orphan a running daemon's marker, and no teardown
// deletes it (cleanStale, daemon stop and the bin's exit cleanup all unlink
// named files only).
//
// Kept out of session-paths.js so that module stays free of IO.

const realFs = require('fs');
const path = require('path');
const crypto = require('crypto');

const paths = require('./session-paths');

// The salt, or null when it is missing, unreadable or empty. Any other content
// IS the salt: an HMAC key needs no particular shape, so there is no
// "malformed" salt to detect or repair. A null salt means no keyed daemon can
// be proven this workspace's (commandNamesWorkspace).
function readSalt(projectRoot, { fs = realFs } = {}) {
  try {
    return String(fs.readFileSync(paths.saltPath(projectRoot), 'utf8')).trim() || null;
  } catch (_) {
    return null;
  }
}

// The salt, created if this workspace has none yet. Throws when it can neither
// read nor create one: an unwritable workspace, or an empty salt file, which
// only a hand edit makes and which is never replaced behind a running
// daemon's back.
//
// Race-free without a lock: the salt is written and fsynced in full to a
// private temp file, then link(2)ed to its final name. link never replaces an
// existing file, so exactly one of several concurrent spawners wins; every
// loser gets EEXIST and reads the winner's salt, which was complete before it
// became visible. A reader therefore never sees a half-written salt. (The
// rename in util/atomic.js would not do: it replaces, so two racers could each
// hand back a different salt.)
function ensureSalt(projectRoot, { fs = realFs } = {}) {
  const existing = readSalt(projectRoot, { fs });
  if (existing) return existing;

  const file = paths.saltPath(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`
  );
  const salt = crypto.randomBytes(32).toString('hex');
  try {
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, `${salt}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      fs.linkSync(tmp, file);
      return salt;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    // Another process won the race; its salt was complete before it was linked.
    const theirs = readSalt(projectRoot, { fs });
    if (theirs) return theirs;
    throw new Error(`the session marker salt at ${file} is empty; delete it and retry`);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch (_) {
      /* never created */
    }
  }
}

module.exports = { ensureSalt, readSalt };
