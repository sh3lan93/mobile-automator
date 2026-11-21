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
// elsewhere, and flush would upload it and then delete it. So every open here
// goes through one checked opener (openSpoolFile), claim() and listClaimed()
// check the directory before they rename or list in it, and every line read
// back passes the field catalog again (shippablePayload), even though the
// writer already applied it: a committed or hand-edited spool never went
// through the writer.

const realFs = require('fs');
const crypto = require('crypto');
const path = require('path');

const { spoolPath } = require('./paths');
const { workspaceDir } = require('../workspace/layout');
const { UnsafePathError, safeDir, openLeaf, openWorkspaceFile } = require('../workspace/safe-fs');
const { telemetryPayload, shippablePayload } = require('./event');

const { O_RDONLY, O_WRONLY, O_APPEND, O_CREAT } = realFs.constants;

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

// Same gate as the file sink: no .mobile-automator/ workspace, no artifacts.
// mauto runs from wherever a user is standing, so creating this tree as a
// side effect of logging would litter unrelated repos with a directory that
// has no .gitignore in it.
function allowed(projectRoot, env, fs) {
  if (env && env.MAUTO_LOG_DIR) return true;
  return fs.existsSync(workspaceDir(projectRoot));
}

function closeQuietly(fs, fd) {
  try {
    fs.closeSync(fd);
  } catch (_) {
    // already closed or invalid: nothing to release
  }
}

// The one way this module opens a spool file (#348). Returns { fd, stat }; the
// caller closes the fd. Throws on any refusal, having closed the fd.
//
// Without MAUTO_LOG_DIR the spool is a workspace file and gets safe-fs's
// workspace rules: a checked directory walk from `.mobile-automator` down, a
// NOFOLLOW regular-file leaf, and an owner check. MAUTO_LOG_DIR is a directory
// the user named in their own environment, so there the spool is the user's
// own path: the NOFOLLOW regular-file leaf still applies, the workspace walk
// and the owner check do not (the rule safe-fs applies to every user-chosen
// path). With O_CREAT the missing directories are created: through safe-fs's
// checked walk in the workspace, and with a plain recursive mkdir under
// MAUTO_LOG_DIR, as before.
//
// In both cases a file with a second hard link is refused, for a read as well
// as a write. safe-fs checks the link count only on writes, but a batch is read
// in order to be uploaded and then unlinked: a second link is a file elsewhere
// by another name, and its contents would ship as this workspace's telemetry.
function openSpoolFile(file, flags, { projectRoot, env, fs, getuid }) {
  let fd;
  if (env && env.MAUTO_LOG_DIR) {
    if (flags & O_CREAT) fs.mkdirSync(path.dirname(file), { recursive: true });
    ({ fd } = openLeaf(file, flags, 0o666, { fs }));
  } else {
    fd = openWorkspaceFile(projectRoot, file, flags, 0o666, { fs, env, getuid });
  }
  try {
    const stat = fs.fstatSync(fd);
    if (stat.nlink !== 1) throw new UnsafePathError(file, 'hardlink');
    return { fd, stat };
  } catch (err) {
    closeQuietly(fs, fd);
    throw err;
  }
}

// Whether claim() and listClaimed() may rename and list inside the spool's
// directory (#348). flush unlinks every batch listClaimed() names, so through
// a `.logs/` that is a link, or that belongs to another user, a flush would
// rename and delete files outside the workspace. Without MAUTO_LOG_DIR the
// directory must pass safe-fs's checked walk; any refusal, or no `.logs/` yet,
// reads as "nothing here". Under MAUTO_LOG_DIR it is the user's own directory
// and is not checked.
function spoolDirUsable(dir, { projectRoot, env, fs, getuid }) {
  if (env && env.MAUTO_LOG_DIR) return true;
  try {
    safeDir(projectRoot, dir, {}, { fs, env, getuid });
    return true;
  } catch (_) {
    return false;
  }
}

// The append opens through openSpoolFile like every read (#348). Once telemetry
// is on, every verb appends here, so a cloned repo that ships
// `.logs/telemetry.spool -> ~/.bashrc`, a `.logs/` that is a link, or a spool
// hard-linked to a file elsewhere would otherwise get JSON appended to a file
// of its choosing. A refused open is a dropped line, like any other failure.
function write(event, { projectRoot, env = process.env, fs = realFs, getuid } = {}) {
  let fd;
  try {
    if (isSelfReferential(event)) return;
    if (!allowed(projectRoot, env, fs)) return;

    let stat;
    ({ fd, stat } = openSpoolFile(spoolPath(projectRoot, env), O_WRONLY | O_APPEND | O_CREAT, {
      projectRoot,
      env,
      fs,
      getuid,
    }));

    // The cap is the size of the file just opened, not of a second lookup by
    // path, which could name a different file. At the cap we drop the NEW line
    // rather than evicting an old one: eviction means read-filter-rewrite on
    // the hot path of every verb, and the older records are the ones already
    // queued for delivery — evicting them loses more history than refusing one
    // new line.
    if (stat.size >= SPOOL_MAX_BYTES) return;

    const payload = telemetryPayload({ ...event, msg_id: newMessageId() });
    fs.writeSync(fd, JSON.stringify(payload) + '\n');
  } catch (_) {
    // Observability is never load-bearing. Losing a telemetry line is always
    // preferable to failing the verb the user actually asked for.
  } finally {
    if (fd !== undefined) closeQuietly(fs, fd);
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
function claim({ projectRoot, env = process.env, fs = realFs, getuid } = {}) {
  const source = spoolPath(projectRoot, env);
  if (!spoolDirUsable(path.dirname(source), { projectRoot, env, fs, getuid })) return null;
  const target = `${source}${CLAIM_SUFFIX}.${process.pid}.${nextClaimStamp()}`;
  try {
    fs.renameSync(source, target);
    return target;
  } catch (_) {
    return null; // nothing spooled, or another flusher beat us to it
  }
}

// Oldest first: the suffix carries pid then epoch-ms, so a lexical sort on the
// trailing number would misorder across digit widths. Sort on the parsed stamp.
function listClaimed({ projectRoot, env = process.env, fs = realFs, getuid } = {}) {
  const dir = path.dirname(spoolPath(projectRoot, env));
  if (!spoolDirUsable(dir, { projectRoot, env, fs, getuid })) return [];
  const prefix = `${path.basename(spoolPath(projectRoot, env))}${CLAIM_SUFFIX}.`;
  let names;
  try {
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

// One spool file through the checked opener: its size and the payloads in it
// that may ship. A refused, absent, oversized or unreadable file is
// { bytes: 0, payloads: [] }, never a throw: observability is never
// load-bearing. The read is bounded by the fstat size of the opened fd, so a
// file that grows after the check cannot push it past SPOOL_READ_MAX_BYTES.
function readSpool(file, { projectRoot, env = process.env, fs = realFs, getuid } = {}) {
  let fd;
  try {
    let stat;
    ({ fd, stat } = openSpoolFile(file, O_RDONLY, { projectRoot, env, fs, getuid }));
    if (stat.size > SPOOL_READ_MAX_BYTES) return { bytes: 0, payloads: [] };
    const buf = Buffer.alloc(stat.size);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return { bytes: stat.size, payloads: shippableLines(buf.toString('utf8', 0, n)) };
  } catch (_) {
    return { bytes: 0, payloads: [] };
  } finally {
    if (fd !== undefined) closeQuietly(fs, fd);
  }
}

// What flush uploads from one batch; [] when the batch is refused (#348).
function readBatch(file, { projectRoot, env = process.env, fs = realFs, getuid } = {}) {
  return readSpool(file, { projectRoot, env, fs, getuid }).payloads;
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
  stats,
};
