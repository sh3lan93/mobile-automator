'use strict';

// NDJSON sink: one JSON object per line, append-only, so a log is greppable,
// streamable, and parseable a line at a time even if the process died mid-file.
//
// Bounded by src/util/log-rotate.js — the codebase's one rotation policy, which
// the daemon's raw stdio log binds to as well. This file used to say that while
// forking the implementation; it now calls it.
//
// Every filesystem operation is guarded: a read-only workspace or a full disk
// must degrade to "no logging", never to a failed `mauto tap`.

const realFs = require('fs');
const path = require('path');

const { mainLogPath, workspaceDir } = require('../paths');
const { MAX_LOG_BYTES, rotateIfLarge } = require('../../util/log-rotate');

function format(event) {
  return JSON.stringify(event) + '\n';
}

// No workspace, no file log.
//
// `mauto` is a CLI run from wherever the user is standing, and unconditional
// mkdir meant every invocation in any directory silently created
// mobile-automator/. That is litter, and worse than litter: `mauto setup`
// writes mobile-automator/.gitignore, so a tree created by the SINK instead of
// by setup is an un-ignored directory accumulating device serials in someone's
// repo, ready for `git add -A`.
//
// The check is on the base dir, not on .logs/ — .logs/ legitimately does not
// exist before the first event, so testing it would mean never logging at all.
// MAUTO_LOG_DIR is exempt: pointing it somewhere is an explicit instruction to
// log there, and it is how a user logs from an un-set-up directory on purpose.
function allowed(projectRoot, env, fs) {
  if (env && env.MAUTO_LOG_DIR) return true;
  return fs.existsSync(workspaceDir(projectRoot));
}

// True when the file is at or past the cap, i.e. the next event would be
// dropped. Exported because `result finalize` has to ask the same question
// about a trace it is about to read, and a second copy of the comparison would
// be a second policy that can drift from this one.
function atCap(target, { fs = realFs, maxBytes = MAX_LOG_BYTES } = {}) {
  try {
    return fs.statSync(target).size >= maxBytes;
  } catch (_) {
    // No file yet, or unreadable: nothing has been dropped.
    return false;
  }
}

// How a log file is kept bounded. TWO modes, ONE constant — this is not a
// second rotation policy, it is the same MAX_LOG_BYTES under a different
// action.
//
// 'rotate' is the shared policy: at the cap, rename to `<log>.1` and start
// fresh. Right for mauto.ndjson and daemon.ndjson, rolling diagnostics where
// the recent past is the part worth keeping.
//
// 'cap' stops appending at the cap, and the difference is not a preference. A
// per-run trace is not a rolling log: its whole CONTENT is a measurement, and
// finalize derives the run duration from its FIRST and last events. Rotating it
// renames the run's beginning out of the live file, so the next finalize would
// compute the span of an arbitrary suffix and write a three-minute run down as
// forty seconds — a number that looks measured, is reported as measured, and is
// wrong, which is strictly worse than the self-report this slice replaces.
// Dropping the NEWEST events instead keeps a contiguous prefix from the true
// start, so a truncated trace still yields a duration with a stated meaning: a
// lower bound, flagged as one via `trace_truncated`.
function shouldAppend(target, bound, fs) {
  if (bound !== 'cap') {
    rotateIfLarge(target, { fs });
    return true;
  }
  return !atCap(target, { fs });
}

// `logPath` lets a caller name the target file explicitly; without it the CLI's
// mauto.ndjson is used. It does NOT bypass allowed(): which file to write is a
// different question from whether this directory has opted into logging at all.
//
// `bound` picks the disk-hygiene policy: 'rotate' (default, unchanged) for
// rolling diagnostics, 'cap' for a run trace. See shouldAppend for why the two
// cannot share behaviour even though they share the one constant that bounds
// them.
function write(event, { projectRoot, env = process.env, fs = realFs, logPath, bound = 'rotate' } = {}) {
  try {
    if (!allowed(projectRoot, env, fs)) return;
    const target = logPath || mainLogPath(projectRoot, env);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!shouldAppend(target, bound, fs)) return;
    fs.appendFileSync(target, format(event));
  } catch (_) {
    // Observability must never be load-bearing. Losing a log line is always
    // preferable to failing the verb the user actually asked for.
  }
}

module.exports = { format, write, atCap };
