'use strict';

// The ONE network path in the shipped tree. tests/lint/telemetry-transport-
// isolation.test.js fails the build if a second one appears anywhere in src/
// or bin/, because the privacy contract ("telemetryPayload() is the only thing
// that builds a network payload") is only true while there is only one wire.
//
// PostHog's documented plain-HTTP capture API, no SDK. An SDK would cost
// cold-start time on every one of the dozens of process spawns a scenario
// makes, and would add supply-chain surface to a project already carrying
// high-severity advisories (#161). The whole transport is one JSON body.
//
// This module RESHAPES a spool line into PostHog's envelope. It never adds a
// fact: everything in `properties` came out of telemetryPayload(), which
// iterates the field catalog rather than the event.

// EU cloud by default. No user content reaches the wire at all (the catalog
// guarantees that), but app package names are the sensitive class this design
// is shaped around, so the region is a cheap belt on top of the braces.
const DEFAULT_HOST = 'https://eu.i.posthog.com';

// A PostHog project API key is WRITE-ONLY and public by design — it authorises
// capture and nothing else, and PostHog embeds it in the <script> tag of every
// site that uses them. Shipping it is therefore correct; fetching it at flush
// time would mean a network round trip before the network round trip, a server
// we must keep alive forever, and no actual protection (anyone can read it out
// of `npm pack`). See "Why the project token ships in the package" in
// docs/plans/2026-09-05-observability-slice-5-plan.md.
//
// Until a maintainer pastes the real value, hasToken() is false and telemetry
// resolves DISABLED with reason `no_token`. A fork or a mid-slice build can
// therefore never post, even with telemetry.enabled true in its config.
const TOKEN_PLACEHOLDER = 'phc_REPLACE_ME';
const PROJECT_TOKEN = 'phc_xD3rE7kJ76yIcVgBKfkarm6cXiNaiEEbSL8q4R5rpBi';

// One event has one identity and no person. distinct_id is a constant and
// $process_person_profile is false, so PostHog creates no person profile at
// all: aggregate verb counts and error rates still work, and there is no
// stable per-machine identifier anywhere in the system to correlate on.
const ANON_DISTINCT_ID = 'mauto-anonymous';

// A hung POST must never pin the daemon or delay its idle reap.
const POST_TIMEOUT_MS = 5000;

// Keys that become top-level wire fields rather than properties, so they are
// not sent twice under two names.
const WIRE_KEYS = ['event', 'ts', 'msg_id'];

function resolveToken(env = process.env) {
  return (env && env.MAUTO_TELEMETRY_TOKEN) || PROJECT_TOKEN;
}

function hasToken(env = process.env) {
  const t = resolveToken(env);
  return Boolean(t) && t !== TOKEN_PLACEHOLDER;
}

function endpointUrl(env = process.env) {
  const host = ((env && env.MAUTO_TELEMETRY_HOST) || DEFAULT_HOST).replace(/\/+$/, '');
  return `${host}/batch/`;
}

function toWireEvent(payload) {
  const properties = { distinct_id: ANON_DISTINCT_ID, $process_person_profile: false };
  for (const [k, v] of Object.entries(payload)) {
    if (WIRE_KEYS.includes(k)) continue;
    properties[k] = v;
  }
  return {
    event: payload.event,
    timestamp: payload.ts,
    uuid: payload.msg_id,
    properties,
  };
}

// Bounds a promise with a deadline without ever leaving a live timer behind.
// The timer is deliberately left REF'D (not unref()'d): src/device/
// failure-probe.js shipped the unref'd version of exactly this and it was a
// real bug — an unref'd timer never fires when nothing else is keeping the
// event loop alive (a one-shot verb, or the daemon between device calls), so
// the race never settles and the caller hangs forever waiting on a deadline
// that was never going to arrive. Keeping it ref'd costs nothing the unref
// was trying to save: the `finally` below already guarantees the timer cannot
// outlive the race on either branch, which is the actual guarantee "don't
// leave a live timer behind" was after. The AbortController is passed to
// fetch as a cooperative cancel; the race is the actual bound, so a fetchImpl
// that ignores the signal still cannot hang the caller.
async function withDeadline(promise, ms, controller) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ timedOut: true });
    }, ms);
  });
  try {
    return await Promise.race([promise.then((response) => ({ response })), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

// Resolves — never rejects. `retry` distinguishes "try this batch again later"
// from "this batch will never succeed":
//
//   4xx except 429  permanent. A malformed body or a revoked token would
//                   otherwise retry forever and the spool would never drain.
//   429, 5xx, throw retryable. Rate limiting, an outage, DNS, a captive portal.
//   timeout         retryable. Indistinguishable from a slow network from here.
async function postBatch(payloads, { fetchImpl, env = process.env, timeoutMs = POST_TIMEOUT_MS } = {}) {
  if (!Array.isArray(payloads) || payloads.length === 0) return { ok: true, retry: false, status: 0 };

  // telemetryPayload() drops a value that fails its accepts() check, so a
  // payload can arrive here with no `event` (an unrecognised event name was
  // dropped). Posting that fragment under an invented event name would be
  // worse than dropping it; skip it instead of pretending it is a real event.
  const usable = payloads.filter((p) => p && p.event);
  if (usable.length === 0) return { ok: true, retry: false, status: 0 };

  if (!hasToken(env)) return { ok: false, retry: false, status: 0 };

  const doFetch = fetchImpl === undefined ? globalThis.fetch : fetchImpl;
  // Node 18 has global fetch; a stripped or exotic runtime might not. Not
  // having a transport is a permanent condition for this process, not a
  // retryable one, so the batch is dropped rather than accumulated forever.
  if (typeof doFetch !== 'function') return { ok: false, retry: false, status: 0 };

  const body = JSON.stringify({
    api_key: resolveToken(env),
    batch: usable.map(toWireEvent),
  });

  const controller = new AbortController();
  try {
    const outcome = await withDeadline(
      doFetch(endpointUrl(env), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      }),
      timeoutMs,
      controller,
    );

    if (outcome.timedOut) return { ok: false, retry: true, status: 0 };

    const status = outcome.response.status;
    if (status >= 200 && status < 300) return { ok: true, retry: false, status };
    if (status === 429 || status >= 500) return { ok: false, retry: true, status };
    return { ok: false, retry: false, status };
  } catch (_) {
    // Network-level: DNS, TLS, abort/timeout, captive portal. All retryable,
    // and none of them is ever allowed to escape into the caller.
    return { ok: false, retry: true, status: 0 };
  }
}

module.exports = {
  DEFAULT_HOST,
  TOKEN_PLACEHOLDER,
  POST_TIMEOUT_MS,
  ANON_DISTINCT_ID,
  resolveToken,
  hasToken,
  endpointUrl,
  postBatch,
};
