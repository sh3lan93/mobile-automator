'use strict';

// The one bounded append to an observe file: the NDJSON log sink
// (sinks/file.js) and the telemetry spool (spool.js) both write through here,
// so the rules for whether to write, where, through what, and when to stop
// exist once (#348).
//
// Three steps, each a single function:
//   * allowed: the no-workspace gate. No .mobile-automator/ and no
//     MAUTO_LOG_DIR means no file is written at all.
//   * settledLeaf: the file inside a directory settled through safe-fs's
//     userDirLeaves (the checked walk when it lands in the workspace, a plain mkdir
//     when it is a MAUTO_LOG_DIR outside it; created only when asked). A
//     cloned repo can ship `.logs/` as a link, so no observe file is reached
//     through a directory that was not checked.
//   * appendLine: one open, write and close, through the settled leaf's open
//     (safe-fs's openOwnedLeaf: O_NOFOLLOW, a regular file, ours, one hard
//     link, the owner rule bound by userDirLeaves). appendFileSync would
//     follow a planted `mauto.ndjson -> ~/.bashrc`, and a file hard-linked to
//     one elsewhere would be written by another name. A refusal throws; every
//     caller drops the line, since observability is never load-bearing.
//
// The cap is checked on the open fd, not by a second lookup of the path: a
// path stat could name a different file than the one about to be written
// (renamed by a rotation or a spool claim between the two calls, or swapped).

const realFs = require('fs');

const { workspaceDir } = require('../workspace/layout');
const { userDirLeaves } = require('../workspace/safe-fs');

const { O_WRONLY, O_APPEND, O_CREAT } = realFs.constants;

// No workspace, no file log, no spool.
//
// `mauto` is a CLI run from wherever the user is standing, and unconditional
// mkdir meant every invocation in any directory silently created
// .mobile-automator/. That is litter, and worse than litter: `mauto setup`
// writes .mobile-automator/.gitignore, so a tree created by a SINK instead of
// by setup is an un-ignored directory accumulating device serials in someone's
// repo, ready for `git add -A`.
//
// The check is on the base dir, not on .logs/ — .logs/ legitimately does not
// exist before the first event, so testing it would mean never logging at all.
// MAUTO_LOG_DIR is exempt: pointing it somewhere is an explicit instruction to
// log there, and it is how a user logs from an un-set-up directory on purpose.
function allowed(projectRoot, env, fs = realFs) {
  if (env && env.MAUTO_LOG_DIR) return true;
  return fs.existsSync(workspaceDir(projectRoot));
}

// `name`'s basename inside `dir`, after settling `dir` through safe-fs's
// userDirLeaves (created when `create`): its leaf, `{ path, open, read }`. The
// path is the one to use: in the workspace it is re-rooted, so it can differ
// from `dir`; a caller that opens nothing (a list, a rename) uses it alone.
// `open` and `read` carry the owner rule userDirLeaves bound from where the
// directory landed: MAUTO_TRUST_WORKSPACE_OWNER=1 applies to a leaf in the
// checkout only, never to one in a MAUTO_LOG_DIR outside it (#363). Throws on
// a refusal.
function settledLeaf(projectRoot, dir, name, { create = false } = {}, { fs = realFs, env, getuid } = {}) {
  return userDirLeaves(projectRoot, dir, { create }, { fs, env, getuid }).leaf(name);
}

// The one size comparison a cap makes, shared by the append below and atCap,
// so the writer and the reader that asks "was anything dropped?" cannot drift.
function reached(size, capBytes) {
  return size >= capBytes;
}

// Appends `line` to `leaf`, a settledLeaf. Returns false when `capBytes` is
// given and the file already holds that much: the NEW line is dropped and
// nothing older is touched. Throws on a refused or failed open or write; the
// fd is closed either way. `fs` writes to the fd the leaf opened.
//
// One open per line: no fd is held between lines, so a rotation or a claim in
// between is never written past.
function appendLine(leaf, line, { capBytes, fs = realFs } = {}) {
  const fd = leaf.open(O_WRONLY | O_APPEND | O_CREAT);
  try {
    if (capBytes !== undefined && reached(fs.fstatSync(fd).size, capBytes)) return false;
    fs.writeSync(fd, line);
    return true;
  } finally {
    fs.closeSync(fd);
  }
}

// True when the file at `target` is at or past `maxBytes`, i.e. an append
// with that cap would have dropped its line. For `result finalize`, which
// reads a trace by path and has to say whether it was truncated; the writer
// never uses it (it checks the fd it opened).
function atCap(target, { fs = realFs, maxBytes } = {}) {
  try {
    return reached(fs.statSync(target).size, maxBytes);
  } catch (_) {
    // No file yet, or unreadable: nothing has been dropped.
    return false;
  }
}

module.exports = { allowed, settledLeaf, appendLine, atCap };
