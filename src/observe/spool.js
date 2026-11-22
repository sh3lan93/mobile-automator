'use strict';

// The telemetry queue: the file every verb writes and no verb reads.
//
// A one-shot process cannot do network I/O. finish() calls process.exit() on
// the line after record(), which tears down a pending socket mid-handshake —
// so a fire-and-forget POST is not merely lossy, it is BIASED toward fast
// machines and warm connections. Awaiting one instead adds a full RTT to every
// `mauto tap`. So a verb appends to this file (tens of microseconds, completes
// before the next statement) and something with an event loop — the daemon, or
// `mauto telemetry flush` — does the network. An undelivered spool is not an
// error state; it is a file the next daemon picks up.
//
// The line written here IS the network payload. Writing the full event and
// redacting at flush time would put the redaction decision on the network path,
// in a process that may be a different version of mauto than the one that wrote
// the line. Redacting at SPOOL time means a device serial is never in the file
// that gets uploaded, and makes the queue auditable: `cat` it and you have seen
// everything that would be sent.
//
// The spool is read as UNTRUSTED input (#348). `.mobile-automator/` is
// committed to repos, so a cloned repo can ship `.logs/telemetry.spool`, a
// claimed batch, or `.logs/` itself, with any content or as a link to a file
// elsewhere, and flush would upload it and then delete it. So the spool goes
// through safe-fs the way the file sink does, and through the same append
// (append.js): every operation first settles its directory with userDir (the
// checked walk in the workspace, created only by write), then opens the leaf
// with openOwnedLeaf / readOwnedLeaf (O_NOFOLLOW, a regular file, ours, one
// hard link, a read included). And
// every line read back passes the field catalog again (shippablePayload), even
// though the writer already applied it: a committed or hand-edited spool never
// went through the writer.
//
// A MAUTO_LOG_DIR inside the workspace gets the workspace rules too (userDir
// re-roots it); outside it the directory is the user's own choice, but the
// leaf is still O_NOFOLLOW, ours and single-link.

const realFs = require('fs');
const crypto = require('crypto');
const path = require('path');

const { spoolPath } = require('./paths');
const { allowed, inSettledDir, appendLine } = require('./append');
const { readOwnedLeaf } = require('../workspace/safe-fs');
const { telemetryPayload, shippablePayload } = require('./event');

// ~1000 lines at ~250 bytes. Not rotateIfLarge: that policy is for LOGS, and
// renaming a queue to `.1` silently discards records that were pending
// delivery, then clobbers that generation on the next rotation. A queue gets a
// hard cap instead.
const SPOOL_MAX_BYTES = 256 * 1024;

// The most a reader takes in from one spool file (#348). A writer stops at
// SPOOL_MAX_BYTES, so anything past this was not written by mauto, and a
// planted multi-gigabyte batch must cost nothing to refuse.
const SPOOL_READ_MAX_BYTES = 1024 * 1024;

// Fixed at `info`, independent of resolveLevels(), because telemetry has its
// own separate control. Two halves, both deliberate:
//   * `debug` never spools — 40x the volume, and debug-only fields are exactly
//     the ones most likely to be newly added and thinly classified.
//   * MAUTO_LOG_LEVEL=silent does not disable telemetry — silencing local logs
//     is not withdrawal of consent, and consent has an explicit control of its
//     own (`mauto telemetry disable`, MAUTO_TELEMETRY=0, DO_NOT_TRACK=1).
const SPOOL_LEVEL = 'info';

const CLAIM_SUFFIX = '.sending';

// Zero-arity, CSPRNG, derived from NOTHING — the same property that makes
// session_id's sends:true classification true rather than asserted. Generated
// per EVENT and never reused, so it cannot correlate two events, let alone two
// machines. It exists so that a re-sent batch (delivery is at-least-once)
// deduplicates at ingestion.
function newMessageId() {
  return crypto.randomBytes(16).toString('hex');
}

// Events about telemetry itself never enter the queue. Without this rule an
// offline machine appends one flush-failure event per flush attempt, forever,
// and the queue that exists to be drained fills itself.
function isSelfReferential(event) {
  return typeof event.event === 'string' && event.event.startsWith('telemetry.');
}

// `name`'s path inside the spool directory, settled through append.js's
// inSettledDir (safe-fs's userDir, created only when `create`). Every
// operation names its file by basename inside the spool directory, never by
// the path it was handed, so none reaches a file through a directory it has
// not checked. Throws on a refusal; each caller reads that as "nothing here".
function inSpoolDir(name, { projectRoot, env, fs, getuid }, { create = false } = {}) {
  return inSettledDir(projectRoot, path.dirname(spoolPath(projectRoot, env)), name, { create }, { fs, env, getuid });
}

// The append is append.js's appendLine, the one the log sink uses (#348).
// Once telemetry is on, every verb appends here, so a cloned repo that ships
// `.logs/telemetry.spool -> ~/.bashrc`, a `.logs/` that is a link, or a spool
// hard-linked to a file elsewhere would otherwise get JSON appended to a file
// of its choosing. A refused open is a dropped line, like any other failure.
//
// The cap is SPOOL_MAX_BYTES, checked on the fd appendLine opened. At the cap
// the NEW line is dropped rather than an old one evicted: eviction means
// read-filter-rewrite on the hot path of every verb, and the older records are
// the ones already queued for delivery — evicting them loses more history
// than refusing one new line.
function write(event, { projectRoot, env = process.env, fs = realFs, getuid } = {}) {
  try {
    if (isSelfReferential(event)) return;
    // Same gate as the file sink: no .mobile-automator/ workspace and no
    // MAUTO_LOG_DIR, no spool (see append.js allowed).
    if (!allowed(projectRoot, env, fs)) return;

    const deps = { fs, env, getuid };
    const file = inSpoolDir(spoolPath(projectRoot, env), { projectRoot, ...deps }, { create: true });
    const payload = telemetryPayload({ ...event, msg_id: newMessageId() });
    appendLine(file, JSON.stringify(payload) + '\n', { ...deps, capBytes: SPOOL_MAX_BYTES });
  } catch (_) {
    // Observability is never load-bearing. Losing a telemetry line is always
    // preferable to failing the verb the user actually asked for.
  }
}

// Monotonic per-process claim stamp, seeded from wall-clock so listClaimed's
// oldest-first sort (which parses this suffix as a number) still reflects
// real ordering across process restarts. Date.now() ALONE is not unique
// enough: a flush that finds a leftover batch and then claims a fresh one
// back-to-back can complete both within the same millisecond, and a rename
// onto an already-existing target SILENTLY REPLACES it on POSIX — destroying
// whichever claim got there first rather than erroring. Falling back to
// `lastClaimStamp + 1` when the clock hasn't advanced guarantees the target
// is always new within this process; a different process can never collide
// regardless, because its pid is already part of the filename.
let lastClaimStamp = 0;
function nextClaimStamp() {
  const now = Date.now();
  lastClaimStamp = now > lastClaimStamp ? now : lastClaimStamp + 1;
  return lastClaimStamp;
}

// Atomic hand-off from "being appended to" to "being sent".
//
// renameSync within a directory is atomic, and it loses nothing: write() opens
// by path and closes per call, so a verb that opened its fd BEFORE the
// rename writes into the claimed inode (that line ships with this batch) and a
// verb that opens AFTER creates a fresh spool. There is no window in which a
// line lands nowhere, and no truncate that could clobber a concurrent writer.
//
// The rename happens inside the userDir-settled directory (#348): flush
// unlinks every batch it claims, so through a `.logs/` that is a link, or that
// belongs to another user, it would rename and delete files elsewhere.
function claim({ projectRoot, env = process.env, fs = realFs, getuid } = {}) {
  try {
    const source = inSpoolDir(spoolPath(projectRoot, env), { projectRoot, env, fs, getuid });
    const target = `${source}${CLAIM_SUFFIX}.${process.pid}.${nextClaimStamp()}`;
    fs.renameSync(source, target);
    return target;
  } catch (_) {
    return null; // nothing spooled, a refused directory, or another flusher beat us to it
  }
}

// Oldest first: the suffix carries pid then epoch-ms, so a lexical sort on the
// trailing number would misorder across digit widths. Sort on the parsed stamp.
// Listed inside the userDir-settled directory, like claim(); a refusal, or no
// directory yet, lists nothing.
function listClaimed({ projectRoot, env = process.env, fs = realFs, getuid } = {}) {
  const prefix = `${path.basename(spoolPath(projectRoot, env))}${CLAIM_SUFFIX}.`;
  let dir;
  let names;
  try {
    dir = path.dirname(inSpoolDir(spoolPath(projectRoot, env), { projectRoot, env, fs, getuid }));
    names = fs.readdirSync(dir);
  } catch (_) {
    return [];
  }
  return names
    .filter((n) => n.startsWith(prefix))
    .map((n) => ({ name: n, stamp: Number(n.slice(n.lastIndexOf('.') + 1)) || 0 }))
    .sort((a, b) => a.stamp - b.stamp)
    .map((e) => path.join(dir, e.name));
}

// The payloads in a spool text that may ship. One bad line must not discard
// the batch around it: a torn final write (the daemon SIGKILLed mid-append) is
// exactly one unparseable line. Each parsed line passes the field catalog
// again (shippablePayload), because the writer's pass proves nothing about a
// spool that was checked in or edited by hand (#348).
function shippableLines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch (_) {
      continue;
    }
    const payload = shippablePayload(value);
    if (payload) out.push(payload);
  }
  return out;
}

// One spool file, by its name inside the settled spool directory: its size and
// the payloads in it that may ship. A refused, absent, oversized or unreadable
// file is { bytes: 0, payloads: [] }, never a throw: observability is never
// load-bearing. The read is capped (readOwnedLeaf reads at most
// SPOOL_READ_MAX_BYTES + 1), and it refuses a second hard link: a batch is
// read to be uploaded and then unlinked, and a second link is a file elsewhere
// by another name whose contents would ship as this workspace's telemetry.
function readSpool(file, { projectRoot, env = process.env, fs = realFs, getuid } = {}) {
  try {
    const deps = { fs, env, getuid };
    const text = readOwnedLeaf(
      inSpoolDir(file, { projectRoot, ...deps }),
      { maxBytes: SPOOL_READ_MAX_BYTES, singleLink: true },
      deps
    );
    if (text === null) return { bytes: 0, payloads: [] };
    return { bytes: Buffer.byteLength(text), payloads: shippableLines(text) };
  } catch (_) {
    return { bytes: 0, payloads: [] };
  }
}

// What flush uploads from one batch; [] when the batch is refused (#348).
function readBatch(file, { projectRoot, env = process.env, fs = realFs, getuid } = {}) {
  return readSpool(file, { projectRoot, env, fs, getuid }).payloads;
}

// Deletes a claimed batch, or one the prune drops: the spool directory is
// walked (userDir, no create), then the batch is unlinked by name inside it.
// Listing and unlinking are separate steps, and a `.logs/` swapped for a link
// between them would otherwise make flush delete a file outside the workspace.
// unlink(2) removes a link leaf itself, never its target. Never throws: a
// batch that is already gone, a read-only `.logs/` or a refused walk all leave
// the file for the next flush's MAX_CLAIMED prune.
function remove(file, { projectRoot, env = process.env, fs = realFs, getuid } = {}) {
  try {
    fs.unlinkSync(inSpoolDir(file, { projectRoot, env, fs, getuid }));
  } catch (_) {
    // the prune is the backstop
  }
}

// What `mauto telemetry status` shows a user deciding whether to opt in. The
// spool is read exactly as flush reads it, so a refused spool shows zeros
// rather than the size of whatever a link points at (#348).
function stats({ projectRoot, env = process.env, fs = realFs, getuid } = {}) {
  const target = spoolPath(projectRoot, env);
  const { bytes, payloads } = readSpool(target, { projectRoot, env, fs, getuid });
  return {
    path: target,
    bytes,
    events: payloads.length,
    pending_batches: listClaimed({ projectRoot, env, fs, getuid }).length,
  };
}

module.exports = {
  SPOOL_MAX_BYTES,
  SPOOL_READ_MAX_BYTES,
  SPOOL_LEVEL,
  CLAIM_SUFFIX,
  newMessageId,
  write,
  claim,
  listClaimed,
  readBatch,
  remove,
  stats,
};
