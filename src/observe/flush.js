'use strict';

// Drains the spool. The only caller of src/observe/transport.js.
//
// Delivery is AT-LEAST-ONCE, deliberately. A batch can be posted successfully
// and then fail to unlink (a SIGKILLed daemon, a read-only .logs), or chunk 1
// can succeed while chunk 2 fails retryably — and in both cases the batch is
// re-sent. Two things make that the right trade:
//
//   * every spooled line carries msg_id, sent as the PostHog event's `uuid`,
//     so ingestion deduplicates;
//   * the alternative — rewriting the claimed file with the unsent remainder —
//     is a write performed on the failure path, whose own failure mode is
//     LOSING records rather than duplicating them. Duplicates are recoverable
//     at the sink; a lost record is not.

const realFs = require('fs');

const spool = require('./spool');
const realTransport = require('./transport');
const { decideForProject } = require('./telemetry');

// Two chunks covers a full 256 KiB spool at ~250 bytes/line, so the duplicate
// window on a partial failure is at most one chunk.
const BATCH_SIZE = 250;

const FLUSH_INTERVAL_MS = 60 * 1000;
const MAX_FLUSH_INTERVAL_MS = 30 * 60 * 1000;

// A permanently-offline machine converges to <= 256 KiB of spool plus this many
// claimed batches, all inside .logs/, which `mauto setup` gitignores.
const MAX_CLAIMED = 3;

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function makeFlusher({
  projectRoot,
  env = process.env,
  transport = realTransport,
  observe = () => {},
  fs = realFs,
} = {}) {
  let nextDelayMs = FLUSH_INTERVAL_MS;

  return async function flush() {
    const decision = decideForProject(projectRoot, env);
    // Layer two of "no upload path is reachable while disabled": the transport
    // is not merely unused here, it is not REACHED. The unit suite injects a
    // transport that throws if called and asserts this line returns first.
    if (!decision.enabled) {
      return { skipped: decision.reason, sent: 0, dropped: 0, kept: 0, kept_events: 0, ok: true, nextDelayMs };
    }

    const startedAt = Date.now();
    let sent = 0;
    let dropped = 0;
    let kept = 0;
    // Payload count of batches left claimed for retry — distinct from `kept`,
    // which counts BATCHES (files), not events. Needed so a flush that only
    // ever retries (nothing sent or dropped yet) still reports how many
    // events it actually touched.
    let keptEvents = 0;
    let lastStatus = 0;
    let retryable = false;

    try {
      // Leftovers first, oldest first, then whatever has accumulated since.
      const batches = spool.listClaimed({ projectRoot, env, fs });
      const fresh = spool.claim({ projectRoot, env, fs });
      if (fresh) batches.push(fresh);

      for (const file of batches) {
        const payloads = spool.readBatch(file, { fs });
        if (payloads.length === 0) {
          safeUnlink(file, fs);
          continue;
        }

        let batchRetryable = false;
        let batchSent = 0;
        let batchDropped = 0;

        for (const part of chunk(payloads, BATCH_SIZE)) {
          let r;
          try {
            r = await transport.postBatch(part, { env });
          } catch (_) {
            // postBatch is documented never to reject; this is the guarantee
            // restated locally so an injected transport cannot break the daemon.
            r = { ok: false, retry: true, status: 0 };
          }
          lastStatus = r.status;
          if (r.ok) {
            batchSent += part.length;
            continue;
          }
          if (r.retry) {
            batchRetryable = true;
            break; // stop at the first retryable chunk; the file stays claimed
          }
          // Permanent (4xx other than 429): a malformed body or a revoked token
          // would retry forever and the queue would never drain. Drop it.
          batchDropped += part.length;
        }

        sent += batchSent;
        dropped += batchDropped;

        if (batchRetryable) {
          kept += 1;
          keptEvents += payloads.length;
          retryable = true;
          break; // the network is down; do not hammer the remaining batches
        }
        safeUnlink(file, fs);
      }

      // Converge: beyond the cap, the oldest claimed batches go.
      const remaining = spool.listClaimed({ projectRoot, env, fs });
      for (const stale of remaining.slice(0, Math.max(0, remaining.length - MAX_CLAIMED))) {
        safeUnlink(stale, fs);
      }
    } catch (_) {
      // Observability is never load-bearing. A flush that blew up in an
      // unanticipated way costs a log line, not a daemon.
      retryable = true;
    }

    // Not merely !retryable: a permanently-rejected batch is dropped rather
    // than retried, so `retryable` stays false for it, but it is still a
    // failed flush — data was lost, not merely delayed. `ok` must reflect
    // both failure shapes, and only the retryable one feeds the backoff
    // below (a permanent drop is definitionally never going to succeed by
    // waiting longer).
    const ok = !retryable && dropped === 0;

    nextDelayMs = retryable
      ? Math.min(nextDelayMs * 2, MAX_FLUSH_INTERVAL_MS)
      : FLUSH_INTERVAL_MS;

    // `debug`, not `warn`. Slice 2 made warn/error the daemon's genuine-failure
    // levels, and daemon.log is where a human debugging a dead daemon looks. A
    // user's flaky wifi is not a daemon failure, and putting it at warn would
    // train that reader to ignore the level that matters.
    if (sent + dropped + kept > 0) {
      observe({
        level: 'debug',
        event: 'telemetry.flush',
        ok,
        count: sent + dropped + keptEvents,
        http_status: lastStatus || undefined,
        dur_ms: Date.now() - startedAt,
      });
    }

    // Units: `kept` counts BATCHES (files) left claimed for retry; `sent`,
    // `dropped` and `kept_events` count events. `kept_events` exists because a
    // flush that only ever retries (nothing sent or dropped yet) still needs
    // to report how many events it actually touched.
    return { sent, dropped, kept, kept_events: keptEvents, ok, nextDelayMs };
  };
}

function safeUnlink(file, fs) {
  try {
    fs.unlinkSync(file);
  } catch (_) {
    // Already gone, or a read-only .logs. Either way the next flush's
    // MAX_CLAIMED prune is the backstop.
  }
}

module.exports = { BATCH_SIZE, FLUSH_INTERVAL_MS, MAX_FLUSH_INTERVAL_MS, MAX_CLAIMED, makeFlusher };
