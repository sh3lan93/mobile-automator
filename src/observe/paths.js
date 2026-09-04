'use strict';

// Pure path helpers for the structured event logs. Side-effect-free so they
// can be unit-tested without touching the filesystem, matching
// src/device/session-paths.js.
//
// NOTE: this is NOT where the daemon's raw stdio goes. That lives at
// mobile-automator/.session/daemon.log (session-paths.logFilePath, PR #176).
// Two artifacts, two homes: raw process output there, structured events here.

const path = require('path');

const LOGS_DIRNAME = '.logs';
const MAIN_LOG_NAME = 'mauto.ndjson';
const DAEMON_LOG_NAME = 'daemon.ndjson';

// The workspace root `mauto setup` creates. The file sink treats its existence
// as permission to log: mauto runs from whatever directory a user is standing
// in, so creating this tree as a side effect of logging would litter unrelated
// repos with a directory that has no .gitignore in it.
function workspaceDir(projectRoot) {
  return path.join(projectRoot, 'mobile-automator');
}

function logsDir(projectRoot, env = process.env) {
  if (env && env.MAUTO_LOG_DIR) return path.resolve(env.MAUTO_LOG_DIR);
  return path.join(projectRoot, 'mobile-automator', LOGS_DIRNAME);
}

function mainLogPath(projectRoot, env = process.env) {
  return path.join(logsDir(projectRoot, env), MAIN_LOG_NAME);
}

// The DAEMON's structured event stream — deliberately a different file from
// mauto.ndjson. Two reasons, in the order they actually carry weight:
//
// VOLUME. A 40-step scenario writes ~40 CLI verb.end lines against 40+ daemon
// call.end lines. Sharing one 1 MiB budget would rotate the CLI's history out
// roughly twice as fast, and the two streams are read for different questions.
//
// PRECEDENT. .session/daemon.log is already a daemon-owned file distinct from
// the CLI's diagnostics. Two writers, two files is the shape this codebase
// already chose.
//
// What this does NOT do is make rotation single-writer, and an earlier version
// of this comment claimed it did. rotateIfLarge is statSync-then-renameSync, so
// concurrent rotations can clobber a generation — but mauto.ndjson is ALREADY
// multi-writer (any two concurrent `mauto` verbs race it), and daemon.ndjson is
// not strictly single-writer either, because a spawn-race lock loser also runs
// bin/mauto-session-daemon.js and writes daemon.lock_conflict here. Splitting
// the files removes the daemon from one instance of that race; it does not
// remove the race. The exposure is a handful of ~200-byte appends in a window of
// milliseconds, worst case one lost generation of a bounded log, and
// rotateIfLarge already swallows the ENOENT a losing rename produces.
//
// It is also not .session/daemon.log, which is the same process's RAW stdio
// (PR #176). Same writer, two artifacts: unstructured text a human reads there,
// parseable events here.
function daemonEventLogPath(projectRoot, env = process.env) {
  return path.join(logsDir(projectRoot, env), DAEMON_LOG_NAME);
}

module.exports = {
  LOGS_DIRNAME,
  MAIN_LOG_NAME,
  DAEMON_LOG_NAME,
  workspaceDir,
  logsDir,
  mainLogPath,
  daemonEventLogPath,
};
