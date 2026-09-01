'use strict';

// Lifecycle of the daemon's log file, so session-spawn.js can stay
// filesystem-free and just hand the stdio triple to child_process.spawn.
//
// Failure policy is PER-STEP, not whole-module. Rotation is a disk guard;
// the diagnostics are the point. A rotation that cannot run — a race with a
// concurrent spawn, a permissions problem — must not cost us the log. Only an
// unopenable log degrades, and it degrades to today's `stdio: 'ignore'`:
// a read-only or full workspace loses diagnostics, never the CLI.

const realFs = require('fs');

const { sessionDir, logFilePath } = require('./session-paths');

const MAX_LOG_BYTES = 1024 * 1024;

// The degraded handle, expressed as a VALUE so callers never branch on null.
// `stdio: 'ignore'` is the behaviour that predates #163.
const IGNORED = Object.freeze({ stdio: 'ignore', write() {}, close() {} });

// Best-effort rotation to a single previous generation; clobbering an existing
// .1 is the intended bound. Every failure here is survivable — no log yet
// (ENOENT on stat), a concurrent spawn that already rotated (ENOENT on rename),
// an unreadable directory (EACCES) — so we swallow and carry on to the open.
// An oversized log beats no log.
function rotateIfLarge(logPath, maxBytes, fs) {
  try {
    if (fs.statSync(logPath).size >= maxBytes) fs.renameSync(logPath, `${logPath}.1`);
  } catch (_) {
    /* nothing to rotate, or someone beat us to it */
  }
}

// Returns { stdio, write, close } — NEVER null.
//
//   stdio  the triple for child_process.spawn. stdout AND stderr point at the
//          same fd on purpose: the child gets dups sharing one O_APPEND file
//          description, so the two streams interleave without clobbering. That
//          one descriptor also captures mobile-mcp, whose MCP stdio transport
//          defaults its stderr to 'inherit' and therefore writes to whatever
//          fd 2 the daemon has. Point fd 2 at /dev/null and its crashes vanish.
//   write  for diagnostics only the PARENT can see. A spawn that fails to exec
//          leaves the child with nothing to say, so this is the sole record of
//          EMFILE/EACCES/ENOENT-on-the-bin (#163).
//   close  releases the parent's dup; the child holds its own.
function openDaemonLog(projectRoot, { maxBytes = MAX_LOG_BYTES, fs = realFs } = {}) {
  let fd;
  try {
    // The parent must create .session/: only startDaemon creates it today, and
    // that runs in the child — too late for an fd the parent has to open first.
    fs.mkdirSync(sessionDir(projectRoot), { recursive: true });

    const logPath = logFilePath(projectRoot);
    rotateIfLarge(logPath, maxBytes, fs);

    // Append, never 'w'. Lock-race losers exit ELOCKED through
    // bin/mauto-session-daemon.js and write to this same file; truncating on
    // open would let a loser erase the winner's just-written crash trace.
    fd = fs.openSync(logPath, 'a');
  } catch (_) {
    return IGNORED;
  }

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

  return { stdio: ['ignore', fd, fd], write, close };
}

module.exports = { MAX_LOG_BYTES, IGNORED, openDaemonLog };
