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
const { rotateIfLarge } = require('../../util/log-rotate');

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

function write(event, { projectRoot, env = process.env, fs = realFs } = {}) {
  try {
    if (!allowed(projectRoot, env, fs)) return;
    const logPath = mainLogPath(projectRoot, env);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    rotateIfLarge(logPath, { fs });
    fs.appendFileSync(logPath, format(event));
  } catch (_) {
    // Observability must never be load-bearing. Losing a log line is always
    // preferable to failing the verb the user actually asked for.
  }
}

module.exports = { format, write };
