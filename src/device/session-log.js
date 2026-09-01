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
// Rotation lives in src/util/log-rotate.js because the structured event log
// wants the identical policy. Re-exported below so this module's public surface
// is unchanged for its existing callers.
const { MAX_LOG_BYTES, rotateIfLarge } = require('../util/log-rotate');

// The degraded handle, expressed as a VALUE so callers never branch on null.
// `stdio: 'ignore'` is the behaviour that predates #163.
const IGNORED = Object.freeze({ stdio: 'ignore', write() {}, close() {} });

// The one sentence pointing a user at the daemon's captured output (#163).
// It lives here because it is a fact about the log, and it is re-exported
// through connection.js so cli.js reaches it via the device facade it already
// imports rather than reaching into a connection-strategy module.
function daemonLogHint(projectRoot) {
  return `The daemon's output (including stack traces) was captured to ${logFilePath(projectRoot)}.`;
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
    rotateIfLarge(logPath, { maxBytes, fs });

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

module.exports = { MAX_LOG_BYTES, IGNORED, daemonLogHint, openDaemonLog };
