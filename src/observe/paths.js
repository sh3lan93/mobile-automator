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
const RUN_TRACE_PREFIX = 'run-';

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

// A run id becomes a FILENAME, so it is validated rather than sanitized.
//
// Sanitizing — replacing the offending characters — is the tempting move and it
// is wrong here: `login/smoke` and `login-smoke` would collapse onto one trace,
// and `result finalize` would then derive a duration spanning two unrelated
// runs. A contaminated measurement presented as measured is worse than no
// measurement, which is the whole premise of this slice. An id that cannot be a
// filename gets NO trace and everything degrades to the MAUTO_RUN_ID-unset
// case, which is 0.24.0's behaviour.
//
// The charset is deliberately WIDER than the result schema's
// ^run_\d{8}_\d{6}$: MAUTO_RUN_ID is agent-chosen and this is not the place to
// start enforcing a pattern the CLI has never enforced. It is narrow enough
// that no accepted value can contain a path separator, a NUL, a drive colon or
// a leading dot, so `..`, `../../etc/x`, `/etc/x` and `C:\x` are all rejected
// by construction rather than by a list of cases someone has to keep complete.
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function isValidRunId(runId) {
  if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) return false;
  // Belt and braces against a future widening of the charset: an accepted id
  // must survive path.basename unchanged, so it can never be a path.
  return path.basename(runId) === runId;
}

// The per-run trace file, or null when the id cannot safely name one.
//
// Returning null rather than throwing is what lets every call site treat "no
// usable run id" and "no run id at all" as one already-handled case, and makes
// this the SINGLE gate: a hostile id cannot be turned into a write target
// anywhere in the codebase, because this is the only function that builds the
// path. src/observe/failure-capture.js reuses it as its own safety check for
// exactly that reason.
function runTracePath(projectRoot, runId, env = process.env) {
  if (!isValidRunId(runId)) return null;
  return path.join(logsDir(projectRoot, env), `${RUN_TRACE_PREFIX}${runId}.ndjson`);
}

module.exports = {
  LOGS_DIRNAME,
  MAIN_LOG_NAME,
  DAEMON_LOG_NAME,
  RUN_TRACE_PREFIX,
  workspaceDir,
  logsDir,
  mainLogPath,
  daemonEventLogPath,
  isValidRunId,
  runTracePath,
};
