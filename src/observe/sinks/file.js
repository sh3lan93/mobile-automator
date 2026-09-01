'use strict';

// NDJSON sink: one JSON object per line, append-only, so a log is greppable,
// streamable, and parseable a line at a time even if the process died mid-file.
//
// Bounded by session-log.js's MAX_LOG_BYTES rather than a constant of its own,
// so the codebase has ONE rotation policy. Single generation (.1), matching
// the daemon log — enough to survive a crash loop, cheap to reason about.
//
// Every filesystem operation is guarded: a read-only workspace or a full disk
// must degrade to "no logging", never to a failed `mauto tap`.

const realFs = require('fs');
const path = require('path');

const { mainLogPath } = require('../paths');
const { MAX_LOG_BYTES } = require('../../device/session-log');

function format(event) {
  return JSON.stringify(event) + '\n';
}

function rotateIfLarge(logPath, fs) {
  let size = 0;
  try {
    size = fs.statSync(logPath).size;
  } catch (_) {
    return; // not present yet — nothing to rotate
  }
  if (size >= MAX_LOG_BYTES) fs.renameSync(logPath, `${logPath}.1`);
}

function write(event, { projectRoot, env = process.env, fs = realFs } = {}) {
  try {
    const logPath = mainLogPath(projectRoot, env);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    rotateIfLarge(logPath, fs);
    fs.appendFileSync(logPath, format(event));
  } catch (_) {
    // Observability must never be load-bearing. Losing a log line is always
    // preferable to failing the verb the user actually asked for.
  }
}

module.exports = { format, write };
