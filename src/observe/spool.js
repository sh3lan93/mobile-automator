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

const realFs = require('fs');
const crypto = require('crypto');
const path = require('path');

const { spoolPath, workspaceDir } = require('./paths');
const { telemetryPayload } = require('./event');

// ~1000 lines at ~250 bytes. Not rotateIfLarge: that policy is for LOGS, and
// renaming a queue to `.1` silently discards records that were pending
// delivery, then clobbers that generation on the next rotation. A queue gets a
// hard cap instead.
const SPOOL_MAX_BYTES = 256 * 1024;

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

// Same gate as the file sink: no mobile-automator/ workspace, no artifacts.
// mauto runs from wherever a user is standing, so creating this tree as a
// side effect of logging would litter unrelated repos with a directory that
// has no .gitignore in it.
function allowed(projectRoot, env, fs) {
  if (env && env.MAUTO_LOG_DIR) return true;
  return fs.existsSync(workspaceDir(projectRoot));
}

function write(event, { projectRoot, env = process.env, fs = realFs } = {}) {
  try {
    if (isSelfReferential(event)) return;
    if (!allowed(projectRoot, env, fs)) return;

    const target = spoolPath(projectRoot, env);
    fs.mkdirSync(path.dirname(target), { recursive: true });

    // One stat before the append. At the cap we drop the NEW line rather than
    // evicting an old one: eviction means read-filter-rewrite on the hot path
    // of every verb, and the older records are the ones already queued for
    // delivery — evicting them loses more history than refusing one new line.
    try {
      if (fs.statSync(target).size >= SPOOL_MAX_BYTES) return;
    } catch (_) {
      /* no spool yet — proceed */
    }

    const payload = telemetryPayload({ ...event, msg_id: newMessageId() });
    fs.appendFileSync(target, JSON.stringify(payload) + '\n');
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
// renameSync within a directory is atomic, and it loses nothing: appendFileSync
// opens by path and closes per call, so a verb that opened its fd BEFORE the
// rename writes into the claimed inode (that line ships with this batch) and a
// verb that opens AFTER creates a fresh spool. There is no window in which a
// line lands nowhere, and no truncate that could clobber a concurrent writer.
function claim({ projectRoot, env = process.env, fs = realFs } = {}) {
  const source = spoolPath(projectRoot, env);
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
function listClaimed({ projectRoot, env = process.env, fs = realFs } = {}) {
  const dir = path.dirname(spoolPath(projectRoot, env));
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

// One bad line must not discard the batch around it. A torn final write (the
// daemon SIGKILLed mid-append) is exactly one unparseable line.
function readBatch(file, { fs = realFs } = {}) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (_) {
    return [];
  }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch (_) {
      /* skip */
    }
  }
  return out;
}

// What `mauto telemetry status` shows a user deciding whether to opt in.
function stats({ projectRoot, env = process.env, fs = realFs } = {}) {
  const target = spoolPath(projectRoot, env);
  let bytes = 0;
  let events = 0;
  try {
    bytes = fs.statSync(target).size;
    events = readBatch(target, { fs }).length;
  } catch (_) {
    /* nothing spooled */
  }
  return {
    path: target,
    bytes,
    events,
    pending_batches: listClaimed({ projectRoot, env, fs }).length,
  };
}

module.exports = {
  SPOOL_MAX_BYTES,
  SPOOL_LEVEL,
  CLAIM_SUFFIX,
  newMessageId,
  write,
  claim,
  listClaimed,
  readBatch,
  stats,
};
