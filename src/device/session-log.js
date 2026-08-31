'use strict';

// Lifecycle of the daemon's log file, so session-spawn.js can stay
// filesystem-free and just hand the fd to child_process.spawn's stdio.
//
// Whole-module failure policy: any throw below is swallowed and openLogFd
// returns null, which puts the caller back on today's `stdio: 'ignore'`
// behaviour. A read-only or full workspace must degrade to no diagnostics —
// it must never take the CLI down.

const realFs = require('fs');

const { sessionDir, logFilePath } = require('./session-paths');

const MAX_LOG_BYTES = 1024 * 1024;

function openLogFd(projectRoot, { maxBytes = MAX_LOG_BYTES, fs = realFs } = {}) {
  try {
    // The parent must create .session/: only startDaemon creates it today, and
    // that runs in the child — too late for an fd the parent has to open first.
    fs.mkdirSync(sessionDir(projectRoot), { recursive: true });

    const logPath = logFilePath(projectRoot);

    // Rotate before opening, so the fresh fd never inherits an oversized file.
    // One generation only; clobbering a previous .1 is the intended bound.
    let size = 0;
    try {
      size = fs.statSync(logPath).size;
    } catch (_) {
      size = 0; // no log yet — nothing to rotate
    }
    if (size >= maxBytes) fs.renameSync(logPath, `${logPath}.1`);

    // Append, never 'w'. Lock-race losers exit ELOCKED through
    // bin/mauto-session-daemon.js and write to this same file; truncating on
    // open would let a loser erase the winner's just-written crash trace.
    const fd = fs.openSync(logPath, 'a');

    // Best-effort by contract: the caller writes a banner on a path where a
    // failed write must not abort the spawn it is annotating.
    const write = (text) => {
      try {
        fs.writeSync(fd, text);
      } catch (_) {
        // Full disk, closed fd — the diagnostics are optional, the spawn is not.
      }
    };

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      try {
        fs.closeSync(fd);
      } catch (_) {
        // Already reaped by the runtime; nothing left to do.
      }
    };

    return { fd, path: logPath, write, close };
  } catch (_) {
    return null;
  }
}

module.exports = { MAX_LOG_BYTES, openLogFd };
