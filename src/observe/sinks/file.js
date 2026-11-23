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
//
// A log under the workspace sits in a tree a cloned repo can fill with
// symlinks (.logs -> /outside, a leaf mauto.ndjson -> a file outside), so it
// is confined like every workspace write (#347). The no-workspace gate, the
// settled directory and the leaf open (O_NOFOLLOW, ours, one link) are
// append.js's, shared with the telemetry spool. A refusal drops the event like
// any other failure here. A log dir outside the workspace (MAUTO_LOG_DIR) is
// the user's explicit choice; its leaf still gets the same open.

const realFs = require('fs');
const path = require('path');

const { mainLogPath } = require('../paths');
const append = require('../append');
const { MAX_LOG_BYTES, rotateIfLarge } = require('../../util/log-rotate');

function format(event) {
  return JSON.stringify(event) + '\n';
}

// True when a run trace is at or past the cap, i.e. the 'cap' bound below has
// been dropping its events. Exported because `result finalize` has to ask that
// question about a trace it is about to read: the cap is bound here, once, and
// the comparison lives in append.js beside the append that enforces it.
function atCap(target, { fs = realFs } = {}) {
  return append.atCap(target, { fs, maxBytes: MAX_LOG_BYTES });
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
// lower bound, flagged as one via `trace_truncated`. The cap is checked by
// appendLine on the fd it opened, not by a path stat beforehand.
//
// `logPath` lets a caller name the target file explicitly; without it the CLI's
// mauto.ndjson is used. It does NOT bypass allowed(): which file to write is a
// different question from whether this directory has opted into logging at all.
//
// The directory is settled once, before rotation; the append then opens the
// leaf without walking again.
function write(event, { projectRoot, env = process.env, fs = realFs, logPath, bound = 'rotate' } = {}) {
  try {
    if (!append.allowed(projectRoot, env, fs)) return;
    const given = logPath || mainLogPath(projectRoot, env);
    const deps = { fs, env };
    const leaf = append.settledLeaf(projectRoot, path.dirname(given), given, { create: true }, deps);
    const capped = bound === 'cap';
    if (!capped) rotateIfLarge(leaf.path, { fs });
    append.appendLine(leaf, format(event), { fs, capBytes: capped ? MAX_LOG_BYTES : undefined });
  } catch (_) {
    // Observability must never be load-bearing. Losing a log line is always
    // preferable to failing the verb the user actually asked for.
  }
}

module.exports = { format, write, atCap };
