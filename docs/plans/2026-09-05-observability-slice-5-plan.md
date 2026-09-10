# mauto Observability — Slice 5 Implementation Plan (opt-in telemetry + graduation)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `mauto` domain C — usage telemetry — without letting a single verb touch the network, without a stable machine identifier, and without any upload path being reachable until a human has explicitly opted in. Then graduate the whole `0.25.0` feature: remove the `MAUTO_OBSERVE` gate (whatever slices 3–4 left of it), collapse `[Unreleased]`, and bump `0.25.0-rc.3` → `0.25.0`.

**Architecture:** `telemetryPayload()` (`src/observe/event.js`) already exists, is allowlist-by-construction, and is lint-guarded. It has no transport. This slice supplies exactly one, in exactly one place, reached by exactly one path:

```
  verb / daemon
      │
   record() ──► defaultSinks(projectRoot, env)
                  ├─ stderr sink          (unchanged)
                  ├─ file  sink           (unchanged)
                  └─ spool sink           ◄── added ONLY when telemetry resolves enabled
                        │
                        │ appendFileSync(telemetryPayload(event) + '\n')
                        ▼
             mobile-automator/.logs/telemetry.spool
                        │
                        │ renameSync  (atomic claim)
                        ▼
             telemetry.spool.sending.<pid>.<ts>
                        │
                        │ src/observe/flush.js  — the ONLY caller of
                        ▼                          src/observe/transport.js
             POST https://eu.i.posthog.com/batch/
```

The spool sink is synchronous, unconditional-success, and never blocks. The daemon runs the flusher on an unref'd timer during its idle window; `mauto telemetry flush` is the explicit escape hatch for a user with no daemon. `src/observe/transport.js` is the only file in `src/` or `bin/` permitted to name `fetch`, and a lint guard enforces that.

**Tech Stack:** Node.js (CommonJS), Commander, Jest, Node's built-in global `fetch`. No new dependencies — this is a hard constraint, not a preference.

**Spec:** `docs/plans/2026-08-31-observability-design.md` (slice 5 in its slice ladder; the "Telemetry transport (C)", "Control surface", "The redaction contract" and "Open questions" sections in particular). The plan whose conventions and quality bar this one continues: `docs/plans/2026-09-01-observability-slice-2-plan.md`.

---

## Global Constraints

- **No new dependencies.** Cold start is ~112ms and one scenario is dozens of process spawns. Nothing may be added to `package.json` `dependencies`. In particular: **no PostHog SDK.** An SDK costs cold-start time on every one of those spawns and adds supply-chain surface to a project already carrying high-severity advisories (#161). Node's global `fetch` and one hand-built JSON body are the whole transport.
- **A verb never touches the network.** Every verb ends in `process.exit()` (`src/cli.js:1698`), which tears down pending sockets: a fire-and-forget POST is dropped a large fraction of the time and an awaited one adds network latency to every `mauto tap`. Verbs append to a local file. The only exceptions are `mauto telemetry flush`, where the user has explicitly asked for a network round trip and is willing to wait for it, and the daemon, which has an event loop and an idle window.
- **`telemetryPayload()` is the only serialisation path.** It iterates `EVENT_FIELDS`, never the event, so an unclassified field is dropped rather than sent. Do not weaken it, do not add a second serialiser, and do not let the transport reach into a raw event. The spool line *is* the network payload; the transport reshapes it into PostHog's wire envelope and adds nothing of its own.
- **A `sends: true` catalog field MUST be a structurally-closed vocabulary, never a raw string.** This shipped as a bug three times (`verb` carried `process.argv[2]`; `tool` needed a pinned allowlist; `session_id` needed a zero-arity CSPRNG generator). Slice 5 adds three fields and each carries the same obligation: `msg_id` (zero-arity CSPRNG, exactly the `newSessionId()` argument), `count` (an integer this code computes), `http_status` (an integer our own endpoint returns).
- **Observability must never be load-bearing.** `record()` is total; every new sink inherits that. The spool sink swallows every filesystem error. The flusher swallows every network error. A full disk, a read-only workspace, a captive-portal DNS hijack and a revoked token must each cost a log line and nothing else.
- **The envelope is locked:** `{ok,data,error,hint,schema_version}` on stdout, nothing else on stdout ever. The new `telemetry` verb emits the envelope like every other verb. Node 18's `fetch` emits an `ExperimentalWarning` on first use — that lands on **stderr**, which is permitted, and in the daemon's case stderr *is* `mobile-automator/.session/daemon.log`.
- **One rotation policy, and the spool is deliberately not covered by it.** `src/util/log-rotate.js` is the policy for *logs*. The spool is a *queue*: renaming it to `.1` would silently discard records that were pending delivery, and a second rotation would clobber the first generation. The spool gets a hard byte cap and drops at the cap instead. This divergence is stated here once so it is not re-argued in review.
- **Bind, do not copy.** The spool becomes a third entry in the existing `defaultSinks` list — not a second sink-list, not a parallel `record()`. That one edit covers the CLI and the daemon at once, because `bin/mauto-session-daemon.js` already builds its recorder through `boundRecorder` → `defaultSinks`.
- **CI version gate:** this touches `src/`, `bin/` and `package.json`, so `version` must move to a value not yet in `git tag`. This is the graduation slice: **`0.25.0-rc.3` → `0.25.0`**. Task 12 asserts the starting version rather than assuming it.
- **Platform-agnostic:** never emit `resource-id` or OS-specific element IDs in any artifact.

---

## The no-network-in-a-one-shot-process analysis

Slice 2 had one cross-cutting design problem (a recorder built for a process that exits immediately, running inside one that lives for hours) and put the reasoning in one named section rather than scattering it across task comments. Slice 5 has one too, and it is the inverse: a *network* feature in a tool whose defining property is that its processes die instantly. Everything in the task list follows from the consequences below.

### 1. Why the spool exists at all

Three options were available and two are unusable:

| | Cost |
|---|---|
| `await fetch(...)` in the verb | Adds a full network RTT to `mauto tap`. A 40-step scenario pays it 40+ times, on the hot path, for a maintainer-facing metric the user gets nothing from. Also makes every verb fail-prone in a new way (DNS, TLS, captive portals). |
| Fire-and-forget `fetch(...)` | `finish()` calls `process.exit()` on the very next line. `process.exit` does not drain pending I/O; the socket is torn down mid-handshake. Delivery becomes a race against TLS setup that the POST usually loses, and the loss is silent, so the metric is not merely lossy — it is *biased* toward fast machines and warm connections. |
| Append to a local file | `appendFileSync` of ~250 bytes is tens of microseconds, cannot fail in a way that matters, and never races `process.exit()` because it completes before the next statement runs. |

So: verbs write to disk; something with an event loop does the network. The daemon is the only such thing this system already has, and it has an idle window by construction (it self-reaps after `DEFAULT_IDLE_MS`, so between device calls it is doing nothing at all). An undelivered spool is not an error state — it is a file that the next daemon picks up.

### 2. What the spool file is, exactly

`mobile-automator/.logs/telemetry.spool`. NDJSON content, one `telemetryPayload(event)` object per line.

**Why not `.ndjson`.** Slice 2 shipped `cat mobile-automator/.logs/*.ndjson` and `jq -s 'sort_by(.ts)' mobile-automator/.logs/*.ndjson` as the documented merged-timeline recipe in `TROUBLESHOOTING.md`. The spool is not part of that timeline — it is a mutating queue that gets renamed out from under a reader — so it must not match that glob. The extension is the interface.

**Why the line is the payload and not the event.** Writing the full event and redacting at flush time would put the redaction decision on the network path, at the moment nobody is looking, in a process that may be a different version of `mauto` than the one that wrote the line. Redacting at *spool* time means a device serial is never written to the file that gets uploaded, so a bug in the flusher cannot leak one. It also makes the file itself auditable: a user can `cat` the spool and see literally everything that would be sent.

**Bound: 256 KiB, drop-newest at the cap.** At ~250 bytes/line that is a thousand-odd events, which is a long offline stretch. Drop-newest rather than drop-oldest because dropping the oldest means read-filter-rewrite on the hot path of every verb, and because the older records are the ones already queued for delivery — evicting them loses more history than refusing one new line. The cap is checked with one `statSync` before the append; on `ENOENT` (no spool yet) the append proceeds.

**The spool never records its own telemetry.** `telemetry.*` events (`telemetry.flush`, `telemetry.spool_full`) are excluded by name in the spool sink. Without that rule an offline machine appends one flush-failure event per flush attempt, forever, and the queue that exists to be drained fills itself. The exclusion is a one-line structural rule with its own test, not a comment.

### 3. Delivery is at-least-once, and the dedupe story is explicit

The flush is claim-then-delete:

1. `renameSync(spool, spool.sending.<pid>.<ts>)`. Atomic within a directory.
2. Read the claimed file, POST it in chunks.
3. On success, `unlink` the claimed file.
4. On a retryable failure, leave it. The next flush picks up leftover `*.sending` files before claiming a fresh one.

Why the rename, and why it loses nothing: `appendFileSync` opens by path and closes per call. A verb that opened its fd *before* the rename writes into the claimed inode — that line goes out with the batch. A verb that opens *after* creates a fresh spool. There is no window in which a line lands nowhere, and there is no truncate that could clobber a concurrent writer.

Where duplicates come from, honestly: the POST can succeed and the `unlink` can then fail, or the daemon can be `SIGKILL`ed between them, or chunk 1 of 3 can succeed and chunk 2 fail-retryable. In all three the batch is re-sent. Two things make that acceptable:

- Every spooled line carries `msg_id`, a zero-arity CSPRNG id generated at spool time, sent as the PostHog event's `uuid`. Ingestion-side deduplication keys on it.
- Even with no deduplication at all, the metrics are counts and rates over a large population, and the duplicate window is bounded to one ≤250-event chunk per failure. That is noise, not corruption.

What is *not* done, and why: the alternative is to rewrite the claimed file with the unsent remainder after a partial success. That is a write performed on the failure path, which can itself fail, and its failure mode is *losing* records rather than duplicating them. Duplicates are recoverable at the sink; a lost record is not.

### 4. What the daemon does when the network is unreachable for a long time

Every one of these is a bound, not a hope:

- **Each POST is bounded** by `AbortSignal.timeout(5000)`. A hung connection cannot pin the daemon or delay its idle reap — the timer is `unref`'d and the flush is fire-and-forget from the timer's perspective.
- **Retries back off.** Consecutive retryable failures double the flush interval from 60s to a 30-minute cap; any success resets it. The backoff lives in the flusher closure, so a fresh daemon starts at 60s again. That is correct rather than sloppy: a new daemon means a new spawn means the user is actively working, which is exactly when re-checking is cheap and worthwhile.
- **4xx is permanent, and the batch is dropped.** A malformed payload or a revoked token would otherwise retry forever and never drain. `429` is excluded from that rule (it is rate limiting, which is retryable) as is every 5xx and every network-level error.
- **Claimed batches are capped at 3.** Beyond that the oldest are unlinked. A permanently-offline machine converges to ≤ 256 KiB of spool plus ≤ 3 claimed batches, all inside `.logs/`, which `mauto setup` already gitignores.
- **Nothing is ever surfaced to the user.** A failing flush records one local event at `debug` — not `warn`. Slice 2 established that `warn` is the daemon's genuine-failure level and that `daemon.log` is where a human debugging a dead daemon is already looking. A user's flaky wifi is not a daemon failure, and putting it at `warn` would train a reader to ignore the level that matters.

### 5. Why the project token ships in the package

**Decision: shipped, as a constant in `src/observe/transport.js`.** The design left this open; this is the answer and the reasoning.

The PostHog *project API key* is a **write-only public token**. It authorises `capture` and nothing else — it cannot read events, cannot read persons, cannot delete, cannot administer. PostHog's own documentation embeds it in the `<script>` tag of every website that uses them; it is public by design in exactly the way a Stripe publishable key is.

Fetching it at flush time would mean:

- a network round trip *before* the network round trip, on a path whose entire design goal is to not do network work;
- an endpoint we must host and keep alive for as long as any published version of `mauto` exists, which is a new permanent operational commitment for a project with no server;
- a new silent-death mode — telemetry stops the day that endpoint moves — which is precisely the class of failure this whole design exists to eliminate;
- and no actual protection, because anyone can read the token out of the flush traffic, or out of `npm pack`, in under a minute.

The genuine risk of a shipped write-only token is a third party spamming our free-tier quota. The blast radius is our own ingestion quota, not user data, PostHog rate-limits per token, and rotating it is a patch release. That is the right trade.

Two guards ride along with the decision:

- `MAUTO_TELEMETRY_TOKEN` and `MAUTO_TELEMETRY_HOST` override the constants, so a self-hoster or a contributor can point at their own project, and so the (already transport-injecting) test suite could never reach the real one even by accident.
- The constant ships as `TOKEN_PLACEHOLDER` (`'phc_REPLACE_ME'`) until a maintainer pastes the real value, and `hasToken()` returns `false` for the placeholder. A fork, a `git clone`, or a mid-slice build therefore resolves telemetry as **disabled with reason `no_token`** and cannot post. Enabled-by-config plus no-token is a no-op, not a crash.

### 6. The consent model: a notice, never a prompt

The design forbids "a first-run prompt that defaults to on". The stronger constraint is that a prompt is *meaningless here*: `mauto` verbs are invoked by an AI agent, not typed by a human at a TTY. There is nobody at the keyboard to answer a question, and an agent answering a consent prompt on a human's behalf is worse than not asking.

So consent is an **explicit affirmative act by the human**, and everything else is a notice:

| | |
|---|---|
| Default | `telemetry.enabled: false`, written **literally** into the config `mauto setup` scaffolds — a visible key with a `false` value, not an absent key that happens to default off. Discoverability is part of consent. |
| Enabling | `mauto telemetry enable` (or `mauto config set telemetry.enabled true`). Nothing else, ever, turns it on. No other verb has a side effect that enables it. |
| Informing | `mauto telemetry status` prints the endpoint, the current state and the *exact field list* — **derived from `EVENT_FIELDS` at runtime**, both the sent and never-sent halves. The disclosure cannot drift from the implementation because it is computed from the same catalog the transport is. |
| Env override | `MAUTO_TELEMETRY=0` and `DO_NOT_TRACK=1` disable, and win over config. |
| Never | a prompt, a countdown, an opt-out banner, a "we've enabled analytics" notice, or enabling as a side effect of any other command. |

**`MAUTO_TELEMETRY=1` deliberately does not enable.** Only `0` is honoured. A kill switch is safe to honour in one direction only: an env var that turns *collection on* is a way to enable collection on a machine whose owner never consented to it — a CI image, a shared shell profile, a `Dockerfile` someone inherited. Off-switches may live in the environment; on-switches must live in a file the project owner edits.

**`mauto telemetry enable` under an active kill switch** writes the config key and then reports honestly that an environment variable currently overrides it, rather than claiming success. The config is the user's durable intent; the env var is this shell's override; conflating them would make the verb lie.

### 7. Why the resolution is memoised, and what that pins

`resolveTelemetry` needs `config.json`, which `resolveLevels` does not. `record()` would otherwise read and parse that file once per event.

`decideForProject(projectRoot, env)` memoises per project root in a module-level `Map`. For a one-shot verb that is one read per process, which is the same shape `resolveLevels` already has. For the daemon it is one read for the daemon's lifetime — pinned exactly like `MAUTO_LOG_LEVEL` and `MAUTO_LOG_DIR` already are (slice 2, point 2), for the same reason and with the same remedy: `mauto session end`, then re-run.

The env kill switches are checked **before** the config read, so `MAUTO_TELEMETRY=0` and `DO_NOT_TRACK=1` cost exactly zero filesystem operations. That ordering is a test, not a comment.

`src/config/manager` is already in `src/cli.js`'s top-level require list (`src/cli.js:18`), so the CLI pays no new cold-start cost. `bin/mauto-session-daemon.js` gains it, once, in a process that is about to spawn a mobile-mcp child.

### 8. "No upload path is reachable while disabled" — made structural

The design asks for a test that injects a transport which fails if called. That is one of three layers, and the weakest:

1. **Construction gate.** The spool sink is only *pushed onto the sink list* when the decision is enabled. While disabled, no spool file is ever created, so there is nothing to flush.
2. **Flush gate.** `flush()` returns `{skipped: 'disabled'}` before touching `transport` at all. The injected always-fail transport proves this.
3. **Structural gate.** `tests/lint/telemetry-transport-isolation.test.js` scans `src/` and `bin/` and fails the build if `fetch(`, `require('http')`, `require('https')` or `XMLHttpRequest` appears anywhere except `src/observe/transport.js`. Verified against the tree as it stands today: there are currently **zero** such occurrences in `src/` or `bin/`, so this guard starts from a clean baseline and any future second upload path fails the build rather than review.

---

### Task 1: Vocabulary — three catalog fields and the transport-isolation guard

Written first because every later task uses these names, and because a field without a catalog entry is silently dropped by `makeEvent` rather than failing loudly at the call site.

`msg_id` is the one that needs its justification stated. It is `sends: true` on exactly the grounds `session_id` is: it comes from a **zero-arity CSPRNG generator** and is derived from nothing — not the project root, not the pid, not the clock. It is generated per *event*, so it cannot correlate two events, let alone two sessions. That is what makes it a delivery-dedupe token rather than a fingerprint.

**Files:**
- Modify: `src/observe/event.js:63-80` (the `EVENT_FIELDS` catalog, `daemon` and `local only` blocks)
- Test: `tests/unit/observe/event.test.js` (extend)
- Test: `tests/lint/telemetry-redaction.test.js` (extend)
- Test: `tests/lint/telemetry-transport-isolation.test.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `EVENT_FIELDS` gains `msg_id`, `count`, `http_status` (all `sends: true`).
  - No change to `NEVER_SENDS`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/observe/event.test.js`:

```js
describe('telemetry transport field classifications', () => {
  const { EVENT_FIELDS, makeEvent, telemetryPayload } = require('../../../src/observe/event');

  it('lets a spooled line carry a delivery id, a batch size and an HTTP status', () => {
    for (const f of ['msg_id', 'count', 'http_status']) {
      expect(EVENT_FIELDS[f]).toBeDefined();
      expect(EVENT_FIELDS[f].sends).toBe(true);
    }
  });

  it('round-trips a flush event through makeEvent without dropping a field', () => {
    const e = makeEvent({
      src: 'daemon',
      event: 'telemetry.flush',
      msg_id: 'b3a1c0de4f5a6b7c8d9e0f1a2b3c4d5e',
      count: 42,
      http_status: 200,
      ok: true,
      dur_ms: 137,
    });
    const p = telemetryPayload(e);
    expect(p.msg_id).toBe('b3a1c0de4f5a6b7c8d9e0f1a2b3c4d5e');
    expect(p.count).toBe(42);
    expect(p.http_status).toBe(200);
  });
});
```

Append to `tests/lint/telemetry-redaction.test.js`, inside the existing `describe('telemetry redaction', ...)`:

```js
  it('keeps every sends:true value a number, a boolean or a generated/enumerated token', () => {
    // The three defects this catches have all shipped: `verb` once carried
    // process.argv[2], `tool` once carried a raw socket-frame string, and
    // `session_id` needed a generator before its classification was true.
    // Anything sends:true must therefore be one of: a value this code computes,
    // a value enforced against a closed set, or a zero-arity CSPRNG token.
    const JUSTIFIED = /closed set|fixed set|fixed vocabulary|enumerated|CSPRNG|carries no user content|our own|integer|boolean|version/i;
    const unjustified = Object.entries(EVENT_FIELDS)
      .filter(([, def]) => def.sends)
      .filter(([, def]) => !JUSTIFIED.test(def.why))
      .map(([name]) => name);
    expect(unjustified).toEqual([]);
  });
```

Create `tests/lint/telemetry-transport-isolation.test.js`:

```js
'use strict';

// Structural guard: exactly ONE file in the shipped tree may talk to the
// network, and this test names it.
//
// The privacy contract is "telemetryPayload() is the only thing that builds a
// network payload". That is only true if there is only one network path. A
// second `fetch(` anywhere in src/ or bin/ — an update check, a crash reporter,
// a docs ping — would bypass the catalog entirely and no redaction test would
// notice, because none of them inspect the wire.
//
// Unix-domain sockets are deliberately NOT matched: src/device/session-client.js
// and src/device/session-daemon.js use net.connect / net.createServer against a
// filesystem path, which never leaves the machine.

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const ALLOWED = path.join('src', 'observe', 'transport.js');

const OUTBOUND = [
  /\bfetch\s*\(/,
  /require\(\s*['"]https?['"]\s*\)/,
  /\bXMLHttpRequest\b/,
];

function jsFilesUnder(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFilesUnder(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

describe('telemetry transport isolation', () => {
  const files = [...jsFilesUnder(path.join(REPO, 'src')), ...jsFilesUnder(path.join(REPO, 'bin'))];

  it('finds an outbound HTTP call in exactly one file', () => {
    const offenders = files
      .filter((f) => {
        const text = fs.readFileSync(f, 'utf8');
        return OUTBOUND.some((re) => re.test(text));
      })
      .map((f) => path.relative(REPO, f))
      .filter((rel) => rel !== ALLOWED);
    expect(offenders).toEqual([]);
  });

  it('scanned a non-trivial number of files, so a broken walk cannot pass vacuously', () => {
    expect(files.length).toBeGreaterThan(30);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest tests/unit/observe/event.test.js tests/lint/telemetry-redaction.test.js tests/lint/telemetry-transport-isolation.test.js
```

Expected: the three new `EVENT_FIELDS` assertions fail (`Cannot read properties of undefined`), and the isolation guard **passes** — the tree has no outbound HTTP today. That is the baseline the guard is meant to hold; it starts green and must stay green everywhere except `transport.js`.

- [ ] **Step 3: Write the implementation**

In `src/observe/event.js`, after the `error_code` entry in the `--- daemon ---` block, add a new block:

```js
  // --- telemetry transport ------------------------------------------------
  // Zero-arity CSPRNG token, generated per EVENT at spool time by
  // src/observe/spool.js newMessageId() and derived from NOTHING — not the
  // project root, not the pid, not the clock. It is sent as the PostHog
  // event's `uuid` so a re-sent batch (delivery is at-least-once; see
  // src/observe/flush.js) deduplicates at ingestion. Per-event and never
  // reused, so it cannot correlate two events, let alone two machines — the
  // opposite of the stable install id this design deliberately does not have.
  msg_id: { sends: true, why: 'zero-arity CSPRNG per-event delivery id; carries no user content' },
  // Integers this code computes, never values a caller supplies.
  count: { sends: true, why: 'integer count (batch size); carries no user content' },
  http_status: { sends: true, why: 'integer HTTP status from our own telemetry endpoint' },
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest tests/unit/observe tests/lint/telemetry-redaction.test.js tests/lint/telemetry-transport-isolation.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/observe/event.js tests/unit/observe/event.test.js tests/lint/telemetry-redaction.test.js tests/lint/telemetry-transport-isolation.test.js
git commit -m "feat(observe): telemetry transport fields and a one-file network guard

msg_id is sends:true on exactly the grounds session_id is — a zero-arity
CSPRNG token derived from nothing — and per-event rather than per-install, so
it dedupes a re-sent batch without being a fingerprint."
```

---

### Task 2: `transport.js` — the PostHog batch POST

The only file allowed to name `fetch`. Written before anything calls it so the isolation guard has its single permitted home from the first commit.

The endpoint is PostHog's documented plain-HTTP capture API: `POST /batch/` with a JSON body carrying `api_key` and an array of events. (`POST /i/v0/e/` is the single-event form; we do not use it — one path, not two.) EU cloud (`eu.i.posthog.com`) is the default host because app package names are the sensitive class this whole design is shaped around, and even though none reach the wire, the region is a cheap belt.

**Files:**
- Create: `src/observe/transport.js`
- Test: `tests/unit/observe/transport.test.js` (create)

**Interfaces:**
- Consumes: nothing from the project. Global `fetch`.
- Produces:
  - `transport.DEFAULT_HOST: 'https://eu.i.posthog.com'`
  - `transport.TOKEN_PLACEHOLDER: 'phc_REPLACE_ME'`
  - `transport.POST_TIMEOUT_MS: 5000`
  - `transport.ANON_DISTINCT_ID: 'mauto-anonymous'`
  - `transport.resolveToken(env) => string`
  - `transport.hasToken(env) => boolean`
  - `transport.endpointUrl(env) => string`
  - `transport.postBatch(payloads, opts) => Promise<{ ok, retry, status }>`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/observe/transport.test.js`:

```js
'use strict';

const transport = require('../../../src/observe/transport');

function fakeFetch(impl) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return impl(calls.length);
  };
  fn.calls = calls;
  return fn;
}

const res = (status) => ({ status, ok: status >= 200 && status < 300 });

describe('telemetry transport', () => {
  const PAYLOADS = [
    { ts: '2026-09-05T10:00:00.000Z', event: 'verb.end', msg_id: 'aaaa', verb: 'tap', ok: true, dur_ms: 41 },
  ];

  it('has no usable token until a maintainer supplies one', () => {
    expect(transport.resolveToken({})).toBe(transport.TOKEN_PLACEHOLDER);
    expect(transport.hasToken({})).toBe(false);
    expect(transport.hasToken({ MAUTO_TELEMETRY_TOKEN: 'phc_real' })).toBe(true);
  });

  it('lets a self-hoster redirect host and token without touching the code', () => {
    expect(transport.endpointUrl({})).toBe('https://eu.i.posthog.com/batch/');
    expect(transport.endpointUrl({ MAUTO_TELEMETRY_HOST: 'https://ph.example.test' }))
      .toBe('https://ph.example.test/batch/');
    // A trailing slash on the host must not produce a double slash.
    expect(transport.endpointUrl({ MAUTO_TELEMETRY_HOST: 'https://ph.example.test/' }))
      .toBe('https://ph.example.test/batch/');
  });

  it('posts the documented PostHog batch shape and adds nothing of its own', async () => {
    const f = fakeFetch(() => res(200));
    const r = await transport.postBatch(PAYLOADS, { fetchImpl: f, env: { MAUTO_TELEMETRY_TOKEN: 'phc_real' } });

    expect(r).toEqual({ ok: true, retry: false, status: 200 });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe('https://eu.i.posthog.com/batch/');
    expect(f.calls[0].init.method).toBe('POST');
    expect(f.calls[0].init.headers['Content-Type']).toBe('application/json');

    const body = f.calls[0].body;
    expect(body.api_key).toBe('phc_real');
    expect(body.batch).toHaveLength(1);

    const ev = body.batch[0];
    expect(ev.event).toBe('verb.end');
    expect(ev.timestamp).toBe('2026-09-05T10:00:00.000Z');
    expect(ev.uuid).toBe('aaaa');
    expect(ev.properties.distinct_id).toBe('mauto-anonymous');
    expect(ev.properties.$process_person_profile).toBe(false);
    // The remaining spool keys ride through as properties, verbatim...
    expect(ev.properties.verb).toBe('tap');
    expect(ev.properties.dur_ms).toBe(41);
    // ...and the three that became wire fields are not duplicated into them.
    expect(ev.properties).not.toHaveProperty('event');
    expect(ev.properties).not.toHaveProperty('ts');
    expect(ev.properties).not.toHaveProperty('msg_id');
  });

  it('never creates a person profile — a stable person is the fingerprint we refuse to have', async () => {
    const f = fakeFetch(() => res(200));
    await transport.postBatch(PAYLOADS, { fetchImpl: f, env: { MAUTO_TELEMETRY_TOKEN: 'phc_real' } });
    const ids = f.calls[0].body.batch.map((e) => e.properties.distinct_id);
    expect(new Set(ids)).toEqual(new Set(['mauto-anonymous']));
  });

  it('treats 4xx as permanent so a revoked token cannot retry forever', async () => {
    for (const status of [400, 401, 403, 413]) {
      const f = fakeFetch(() => res(status));
      const r = await transport.postBatch(PAYLOADS, { fetchImpl: f, env: { MAUTO_TELEMETRY_TOKEN: 'phc_real' } });
      expect(r).toEqual({ ok: false, retry: false, status });
    }
  });

  it('treats 429 and 5xx as retryable', async () => {
    for (const status of [429, 500, 502, 503]) {
      const f = fakeFetch(() => res(status));
      const r = await transport.postBatch(PAYLOADS, { fetchImpl: f, env: { MAUTO_TELEMETRY_TOKEN: 'phc_real' } });
      expect(r).toEqual({ ok: false, retry: true, status });
    }
  });

  it('treats a thrown network error as retryable and never propagates it', async () => {
    const f = async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    };
    const r = await transport.postBatch(PAYLOADS, { fetchImpl: f, env: { MAUTO_TELEMETRY_TOKEN: 'phc_real' } });
    expect(r).toEqual({ ok: false, retry: true, status: 0 });
  });

  it('refuses to post without a real token, and does not call fetch to find out', async () => {
    const f = fakeFetch(() => res(200));
    const r = await transport.postBatch(PAYLOADS, { fetchImpl: f, env: {} });
    expect(r).toEqual({ ok: false, retry: false, status: 0 });
    expect(f.calls).toHaveLength(0);
  });

  it('posts nothing for an empty batch', async () => {
    const f = fakeFetch(() => res(200));
    const r = await transport.postBatch([], { fetchImpl: f, env: { MAUTO_TELEMETRY_TOKEN: 'phc_real' } });
    expect(r).toEqual({ ok: true, retry: false, status: 0 });
    expect(f.calls).toHaveLength(0);
  });

  it('degrades rather than throwing on a runtime with no global fetch', async () => {
    const r = await transport.postBatch(PAYLOADS, {
      fetchImpl: null,
      env: { MAUTO_TELEMETRY_TOKEN: 'phc_real' },
    });
    expect(r).toEqual({ ok: false, retry: false, status: 0 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest tests/unit/observe/transport.test.js
```

Expected: `Cannot find module '../../../src/observe/transport'`.

- [ ] **Step 3: Write the implementation**

Create `src/observe/transport.js`:

```js
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
const PROJECT_TOKEN = TOKEN_PLACEHOLDER;

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
    event: payload.event || 'mauto.event',
    timestamp: payload.ts,
    uuid: payload.msg_id,
    properties,
  };
}

// Resolves — never rejects. `retry` distinguishes "try this batch again later"
// from "this batch will never succeed":
//
//   4xx except 429  permanent. A malformed body or a revoked token would
//                   otherwise retry forever and the spool would never drain.
//   429, 5xx, throw retryable. Rate limiting, an outage, DNS, a captive portal.
async function postBatch(payloads, { fetchImpl, env = process.env, timeoutMs = POST_TIMEOUT_MS } = {}) {
  if (!Array.isArray(payloads) || payloads.length === 0) return { ok: true, retry: false, status: 0 };
  if (!hasToken(env)) return { ok: false, retry: false, status: 0 };

  const doFetch = fetchImpl === undefined ? globalThis.fetch : fetchImpl;
  // Node 18 has global fetch; a stripped or exotic runtime might not. Not
  // having a transport is a permanent condition for this process, not a
  // retryable one, so the batch is dropped rather than accumulated forever.
  if (typeof doFetch !== 'function') return { ok: false, retry: false, status: 0 };

  const body = JSON.stringify({
    api_key: resolveToken(env),
    batch: payloads.map(toWireEvent),
  });

  try {
    const response = await doFetch(endpointUrl(env), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const status = response.status;
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
```

**Note for the implementer, do not skip:** `$process_person_profile: false` is PostHog's documented flag for anonymous events (it suppresses person-profile creation). Confirm it against PostHog's current capture docs when you paste the real token in Task 12. If it has been renamed, the correct fallback is to omit the property entirely and keep the constant `distinct_id` — the privacy property (no stable per-machine identifier) comes from the constant, not from the flag; the flag only spares PostHog a useless person row. Do **not** "fix" it by switching to a per-install id.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest tests/unit/observe/transport.test.js tests/lint/telemetry-transport-isolation.test.js
```

Both green: the transport works, and it is still the only file allowed to have it.

- [ ] **Step 5: Commit**

```bash
git add src/observe/transport.js tests/unit/observe/transport.test.js
git commit -m "feat(observe): PostHog batch transport, no SDK, one file

The project token is a write-only public key and ships in the package; the
placeholder resolves telemetry disabled until a maintainer replaces it. 4xx is
permanent so a revoked token cannot retry forever."
```

---

### Task 3: `telemetry.js` — the control surface

The resolver. Pure precedence logic plus one memoised config read, and the single home for the consent copy so it cannot drift between the verb, the setup envelope and the docs.

**Files:**
- Create: `src/observe/telemetry.js`
- Test: `tests/unit/observe/telemetry.test.js` (create)

**Interfaces:**
- Consumes: `EVENT_FIELDS`, `NEVER_SENDS` from `src/observe/event.js`; `hasToken`, `endpointUrl` from `src/observe/transport.js`; `load` from `src/config/manager.js`.
- Produces:
  - `telemetry.CONSENT_NOTICE: string`
  - `telemetry.REASONS: ReadonlyArray<'kill_switch'|'do_not_track'|'not_configured'|'no_token'|'enabled'>`
  - `telemetry.envKillSwitch(env) => string|null`
  - `telemetry.resolveTelemetry({ env, config }) => { enabled: boolean, reason: string }`
  - `telemetry.decideForProject(projectRoot, env) => { enabled, reason }` (memoised)
  - `telemetry._resetMemo() => void` (test seam)
  - `telemetry.sentFields() => string[]`, `telemetry.neverSentFields() => string[]`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/observe/telemetry.test.js`:

```js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const telemetry = require('../../../src/observe/telemetry');
const { EVENT_FIELDS, NEVER_SENDS } = require('../../../src/observe/event');

const ON = { telemetry: { enabled: true } };
const TOKEN = { MAUTO_TELEMETRY_TOKEN: 'phc_real' };

function workspace(config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-tel-'));
  fs.mkdirSync(path.join(root, 'mobile-automator'), { recursive: true });
  if (config !== undefined) {
    fs.writeFileSync(
      path.join(root, 'mobile-automator', 'config.json'),
      JSON.stringify(config, null, 2)
    );
  }
  return root;
}

beforeEach(() => telemetry._resetMemo());

describe('telemetry control surface', () => {
  it('is off when nothing has been configured', () => {
    expect(telemetry.resolveTelemetry({ env: TOKEN, config: null }))
      .toEqual({ enabled: false, reason: 'not_configured' });
    expect(telemetry.resolveTelemetry({ env: TOKEN, config: {} }))
      .toEqual({ enabled: false, reason: 'not_configured' });
    expect(telemetry.resolveTelemetry({ env: TOKEN, config: { telemetry: { enabled: false } } }))
      .toEqual({ enabled: false, reason: 'not_configured' });
  });

  it('is on only for a literal true in the config, not a truthy string', () => {
    expect(telemetry.resolveTelemetry({ env: TOKEN, config: ON }))
      .toEqual({ enabled: true, reason: 'enabled' });
    expect(telemetry.resolveTelemetry({ env: TOKEN, config: { telemetry: { enabled: 'true' } } }))
      .toEqual({ enabled: false, reason: 'not_configured' });
  });

  it('lets MAUTO_TELEMETRY=0 win over an enabled config', () => {
    expect(telemetry.resolveTelemetry({ env: { ...TOKEN, MAUTO_TELEMETRY: '0' }, config: ON }))
      .toEqual({ enabled: false, reason: 'kill_switch' });
  });

  it('honours DO_NOT_TRACK', () => {
    for (const v of ['1', 'true', 'TRUE']) {
      expect(telemetry.resolveTelemetry({ env: { ...TOKEN, DO_NOT_TRACK: v }, config: ON }))
        .toEqual({ enabled: false, reason: 'do_not_track' });
    }
    // DO_NOT_TRACK=0 is an explicit "tracking is fine", not a kill switch.
    expect(telemetry.resolveTelemetry({ env: { ...TOKEN, DO_NOT_TRACK: '0' }, config: ON }))
      .toEqual({ enabled: true, reason: 'enabled' });
  });

  it('does NOT let MAUTO_TELEMETRY=1 enable collection', () => {
    // An off-switch may live in the environment. An ON-switch may not: it is a
    // way to enable collection on a machine — a CI image, a shared profile, an
    // inherited Dockerfile — whose owner never consented.
    expect(telemetry.resolveTelemetry({ env: { ...TOKEN, MAUTO_TELEMETRY: '1' }, config: null }))
      .toEqual({ enabled: false, reason: 'not_configured' });
  });

  it('stays off when the shipped token is still the placeholder', () => {
    expect(telemetry.resolveTelemetry({ env: {}, config: ON }))
      .toEqual({ enabled: false, reason: 'no_token' });
  });

  it('checks the kill switches before it reads any config', () => {
    const root = workspace(ON);
    const spy = jest.spyOn(fs, 'readFileSync');
    const before = spy.mock.calls.length;
    expect(telemetry.decideForProject(root, { ...TOKEN, MAUTO_TELEMETRY: '0' }))
      .toEqual({ enabled: false, reason: 'kill_switch' });
    expect(spy.mock.calls.length).toBe(before);
    spy.mockRestore();
  });

  it('reads config.json once per project root, not once per event', () => {
    const root = workspace(ON);
    const spy = jest.spyOn(fs, 'readFileSync');
    for (let i = 0; i < 25; i++) telemetry.decideForProject(root, TOKEN);
    const reads = spy.mock.calls.filter(([p]) => String(p).endsWith('config.json'));
    expect(reads).toHaveLength(1);
    spy.mockRestore();
  });

  it('degrades to disabled when the config is unreadable or corrupt', () => {
    const root = workspace();
    fs.writeFileSync(path.join(root, 'mobile-automator', 'config.json'), '{ not json');
    expect(telemetry.decideForProject(root, TOKEN))
      .toEqual({ enabled: false, reason: 'not_configured' });
  });

  it('derives its disclosure from the catalog rather than restating it', () => {
    expect(telemetry.sentFields().sort())
      .toEqual(Object.keys(EVENT_FIELDS).filter((k) => EVENT_FIELDS[k].sends).sort());
    expect(telemetry.neverSentFields().sort()).toEqual([...NEVER_SENDS].sort());
    // The two halves cannot overlap; that is the redaction contract.
    const overlap = telemetry.sentFields().filter((f) => telemetry.neverSentFields().includes(f));
    expect(overlap).toEqual([]);
  });

  it('states the consent rules in one place, and never asks a question', () => {
    expect(telemetry.CONSENT_NOTICE).toContain('off by default');
    expect(telemetry.CONSENT_NOTICE).toContain('mauto telemetry enable');
    expect(telemetry.CONSENT_NOTICE).toContain('mauto telemetry status');
    // A notice, not a prompt: nothing in it may read as a question to answer.
    expect(telemetry.CONSENT_NOTICE).not.toMatch(/\?/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest tests/unit/observe/telemetry.test.js
```

Expected: `Cannot find module '../../../src/observe/telemetry'`.

- [ ] **Step 3: Write the implementation**

Create `src/observe/telemetry.js`:

```js
'use strict';

// Resolves whether telemetry is on, and owns the consent copy.
//
// Precedence, in this order and for these reasons:
//
//   1. MAUTO_TELEMETRY=0   a kill switch must win over everything, and it is
//                          checked FIRST so it costs zero filesystem calls.
//   2. DO_NOT_TRACK=1      the cross-tool convention, honoured.
//   3. telemetry.enabled   the user's durable, explicit opt-in.
//   4. a real token         a placeholder build cannot post even if enabled.
//
// MAUTO_TELEMETRY=1 deliberately does NOT enable. An off-switch is safe to
// honour from the environment; an on-switch is a way to turn collection on for
// a machine — a CI image, a shared shell profile, an inherited Dockerfile —
// whose owner never consented. On-switches live in a file the project owner
// edits.

const configManager = require('../config/manager');
const { EVENT_FIELDS, NEVER_SENDS } = require('./event');
const { hasToken } = require('./transport');

const REASONS = Object.freeze([
  'kill_switch',
  'do_not_track',
  'not_configured',
  'no_token',
  'enabled',
]);

// The single home for the consent copy. `mauto telemetry status`, the setup
// envelope and docs/reference/telemetry.md all render THIS string; three
// hand-written copies would drift, and the one that drifts is the one a user
// reads before deciding.
//
// It is a NOTICE, never a prompt. mauto verbs are invoked by an agent, not
// typed by a human, so there is nobody at the keyboard to answer a question —
// and an agent answering a consent question on a human's behalf is worse than
// not asking.
const CONSENT_NOTICE = [
  'Telemetry is off by default and nothing is sent until you turn it on.',
  '',
  'When enabled, mauto records anonymous usage counts — which verb ran, whether',
  'it succeeded, how long it took, and the mobile-mcp primitive behind it. It',
  'sends no free text of any kind: no scenario ids, app package names, device',
  'serials, element labels, typed input or filesystem paths. There is no',
  'per-machine identifier; every event is anonymous and uncorrelated.',
  '',
  'Run `mauto telemetry status` to see the exact field list, read from the same',
  'catalog the uploader uses. Run `mauto telemetry enable` to turn it on, or set',
  'MAUTO_TELEMETRY=0 (or DO_NOT_TRACK=1) to force it off everywhere.',
].join('\n');

function envKillSwitch(env = process.env) {
  if (String((env && env.MAUTO_TELEMETRY) || '') === '0') return 'kill_switch';
  const dnt = String((env && env.DO_NOT_TRACK) || '').toLowerCase();
  if (dnt === '1' || dnt === 'true') return 'do_not_track';
  return null;
}

function resolveTelemetry({ env = process.env, config = null } = {}) {
  const killed = envKillSwitch(env);
  if (killed) return { enabled: false, reason: killed };
  // A LITERAL true. A truthy string ("true", "1") means someone hand-edited
  // the file into a shape `mauto config set` would never produce, and guessing
  // at intent is not something a consent flag gets to do.
  const configured = Boolean(config && config.telemetry && config.telemetry.enabled === true);
  if (!configured) return { enabled: false, reason: 'not_configured' };
  if (!hasToken(env)) return { enabled: false, reason: 'no_token' };
  return { enabled: true, reason: 'enabled' };
}

// Memoised per project root. resolveLevels() is re-derived per record() call
// because it reads only env; this one reads config.json, and a file read per
// event is not acceptable on a path that runs on every verb.
//
// The pinning consequence is the same one slice 2 documented for the daemon's
// MAUTO_LOG_LEVEL: for a one-shot verb this is once per process (correct by
// construction), and for the daemon it is once per daemon lifetime. Editing
// config.json while a daemon is running does not change that daemon's
// behaviour; `mauto session end` then re-run is the remedy.
const memo = new Map();

function decideForProject(projectRoot, env = process.env) {
  const key = String(projectRoot);
  if (memo.has(key)) return memo.get(key);
  let decision;
  try {
    // Checked before the read, not after: a kill switch must cost nothing.
    decision = envKillSwitch(env)
      ? resolveTelemetry({ env, config: null })
      : resolveTelemetry({ env, config: configManager.load(projectRoot) });
  } catch (_) {
    // A corrupt or unreadable config resolves OFF. Failing closed is the only
    // acceptable direction for a consent flag.
    decision = { enabled: false, reason: 'not_configured' };
  }
  memo.set(key, decision);
  return decision;
}

function _resetMemo() {
  memo.clear();
}

// The disclosure is COMPUTED from the catalog, never restated. That is what
// makes `mauto telemetry status` and docs/reference/telemetry.md incapable of
// lying: they render the same source of truth telemetryPayload() iterates.
function sentFields() {
  return Object.keys(EVENT_FIELDS).filter((k) => EVENT_FIELDS[k].sends);
}

function neverSentFields() {
  return [...NEVER_SENDS];
}

module.exports = {
  CONSENT_NOTICE,
  REASONS,
  envKillSwitch,
  resolveTelemetry,
  decideForProject,
  _resetMemo,
  sentFields,
  neverSentFields,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest tests/unit/observe/telemetry.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/observe/telemetry.js tests/unit/observe/telemetry.test.js
git commit -m "feat(observe): telemetry control surface, off by default

Kill switches are checked before any config read, so MAUTO_TELEMETRY=0 costs
zero filesystem calls. MAUTO_TELEMETRY=1 deliberately does not enable: an
off-switch may live in the environment, an on-switch may not."
```

---

### Task 4: `spool.js` — the append-only queue and its sink

The file every verb writes and no verb reads. Synchronous, capped, self-excluding, and it emits the network payload rather than the event.

**Files:**
- Create: `src/observe/spool.js`
- Modify: `src/observe/paths.js:13-15` (add `SPOOL_NAME`) and export `spoolPath`
- Test: `tests/unit/observe/spool.test.js` (create)
- Test: `tests/unit/observe/paths.test.js` (extend)

**Interfaces:**
- Consumes: `logsDir`, `workspaceDir` from `src/observe/paths.js`; `telemetryPayload` from `src/observe/event.js`.
- Produces:
  - `paths.SPOOL_NAME: 'telemetry.spool'`
  - `paths.spoolPath(projectRoot, env?) => string`
  - `spool.SPOOL_MAX_BYTES: 262144`
  - `spool.SPOOL_LEVEL: 'info'`
  - `spool.CLAIM_SUFFIX: '.sending'`
  - `spool.newMessageId() => string`
  - `spool.write(event, { projectRoot, env, fs }) => void`
  - `spool.claim({ projectRoot, env, fs }) => string|null`
  - `spool.listClaimed({ projectRoot, env, fs }) => string[]`
  - `spool.readBatch(file, { fs }) => object[]`
  - `spool.stats({ projectRoot, env, fs }) => { path, bytes, events, pending_batches }`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/observe/paths.test.js`:

```js
describe('telemetry spool path', () => {
  const { SPOOL_NAME, spoolPath, MAIN_LOG_NAME, DAEMON_LOG_NAME } = require('../../../src/observe/paths');
  const path = require('path');

  it('lives beside the event logs', () => {
    expect(spoolPath('/p', {})).toBe(path.join('/p', 'mobile-automator', '.logs', 'telemetry.spool'));
  });

  it('follows MAUTO_LOG_DIR like every other artifact in .logs/', () => {
    expect(spoolPath('/p', { MAUTO_LOG_DIR: '/tmp/elsewhere' }))
      .toBe(path.join('/tmp/elsewhere', 'telemetry.spool'));
  });

  it('is deliberately NOT a .ndjson file', () => {
    // TROUBLESHOOTING.md documents `cat mobile-automator/.logs/*.ndjson` as the
    // merged CLI+daemon timeline. The spool is a mutating queue that gets
    // renamed out from under a reader, not part of that timeline, so it must
    // not match that glob. The extension is the interface.
    expect(SPOOL_NAME.endsWith('.ndjson')).toBe(false);
    expect([MAIN_LOG_NAME, DAEMON_LOG_NAME].every((n) => n.endsWith('.ndjson'))).toBe(true);
  });
});
```

Create `tests/unit/observe/spool.test.js`:

```js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const spool = require('../../../src/observe/spool');
const { spoolPath } = require('../../../src/observe/paths');

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-spool-'));
  fs.mkdirSync(path.join(root, 'mobile-automator'), { recursive: true });
  return root;
}

const readLines = (p) =>
  fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

describe('telemetry spool', () => {
  it('writes the NETWORK payload, not the event — a serial is never in the file that gets uploaded', () => {
    const root = workspace();
    spool.write(
      {
        ts: '2026-09-05T10:00:00.000Z',
        v: 1,
        level: 'info',
        src: 'cli',
        event: 'verb.end',
        verb: 'launch',
        ok: true,
        dur_ms: 41,
        // every one of these is sends:false
        app_id: 'com.acme.unreleased-thing',
        device_id: 'emulator-5554',
        run_id: 'project-phoenix-0031',
        path: '/Users/someone/secret/app.apk',
      },
      { projectRoot: root, env: {} }
    );

    const [line] = readLines(spoolPath(root, {}));
    expect(line.verb).toBe('launch');
    expect(line.dur_ms).toBe(41);
    for (const f of ['app_id', 'device_id', 'run_id', 'path']) {
      expect(line).not.toHaveProperty(f);
    }
  });

  it('stamps a fresh CSPRNG message id on every line', () => {
    const root = workspace();
    for (let i = 0; i < 5; i++) {
      spool.write({ level: 'info', src: 'cli', event: 'verb.end', ok: true }, { projectRoot: root, env: {} });
    }
    const ids = readLines(spoolPath(root, {})).map((l) => l.msg_id);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    expect(ids.every((id) => /^[0-9a-f]{32}$/.test(id))).toBe(true);
  });

  it('never spools its own telemetry events', () => {
    // Without this an offline machine appends one flush-failure event per
    // flush attempt, forever: the queue that exists to be drained fills itself.
    const root = workspace();
    spool.write({ level: 'debug', src: 'daemon', event: 'telemetry.flush', ok: false }, { projectRoot: root, env: {} });
    spool.write({ level: 'info', src: 'daemon', event: 'telemetry.spool_full' }, { projectRoot: root, env: {} });
    expect(fs.existsSync(spoolPath(root, {}))).toBe(false);
  });

  it('refuses to spool in a directory that never ran `mauto setup`', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-bare-'));
    spool.write({ level: 'info', src: 'cli', event: 'verb.end', ok: true }, { projectRoot: bare, env: {} });
    expect(fs.existsSync(spoolPath(bare, {}))).toBe(false);
  });

  it('drops at the cap instead of rotating — a rotated generation would never be delivered', () => {
    const root = workspace();
    const target = spoolPath(root, {});
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'x'.repeat(spool.SPOOL_MAX_BYTES + 1));

    spool.write({ level: 'info', src: 'cli', event: 'verb.end', ok: true }, { projectRoot: root, env: {} });

    expect(fs.statSync(target).size).toBe(spool.SPOOL_MAX_BYTES + 1);
    expect(fs.existsSync(`${target}.1`)).toBe(false);
  });

  it('never throws, whatever the filesystem does', () => {
    const root = workspace();
    const boom = () => {
      throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
    };
    expect(() =>
      spool.write(
        { level: 'info', src: 'cli', event: 'verb.end', ok: true },
        { projectRoot: root, env: {}, fs: { ...fs, appendFileSync: boom, statSync: boom, mkdirSync: boom, existsSync: () => true } }
      )
    ).not.toThrow();
  });

  it('claims the spool by rename, so a concurrent writer loses nothing', () => {
    const root = workspace();
    spool.write({ level: 'info', src: 'cli', event: 'verb.end', ok: true }, { projectRoot: root, env: {} });

    const claimed = spool.claim({ projectRoot: root, env: {} });
    expect(claimed).toMatch(/telemetry\.spool\.sending\.\d+\.\d+$/);
    expect(fs.existsSync(spoolPath(root, {}))).toBe(false);
    expect(spool.readBatch(claimed)).toHaveLength(1);

    // A verb that runs during the flush starts a fresh spool.
    spool.write({ level: 'info', src: 'cli', event: 'verb.end', ok: false }, { projectRoot: root, env: {} });
    expect(spool.readBatch(spoolPath(root, {}))).toHaveLength(1);
  });

  it('claims nothing when there is nothing to claim', () => {
    const root = workspace();
    expect(spool.claim({ projectRoot: root, env: {} })).toBeNull();
  });

  it('lists leftover claimed batches oldest-first so retries stay in order', () => {
    const root = workspace();
    const dir = path.dirname(spoolPath(root, {}));
    fs.mkdirSync(dir, { recursive: true });
    for (const name of ['telemetry.spool.sending.9.300', 'telemetry.spool.sending.9.100', 'telemetry.spool.sending.9.200']) {
      fs.writeFileSync(path.join(dir, name), '{}\n');
    }
    expect(spool.listClaimed({ projectRoot: root, env: {} }).map((f) => path.basename(f))).toEqual([
      'telemetry.spool.sending.9.100',
      'telemetry.spool.sending.9.200',
      'telemetry.spool.sending.9.300',
    ]);
  });

  it('skips an unparseable line rather than discarding the batch around it', () => {
    const root = workspace();
    const dir = path.dirname(spoolPath(root, {}));
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'telemetry.spool.sending.1.1');
    fs.writeFileSync(f, '{"event":"a"}\nnot json\n\n{"event":"b"}\n');
    expect(spool.readBatch(f).map((e) => e.event)).toEqual(['a', 'b']);
  });

  it('reports what a user would want to see before deciding to opt in', () => {
    const root = workspace();
    spool.write({ level: 'info', src: 'cli', event: 'verb.end', ok: true }, { projectRoot: root, env: {} });
    const s = spool.stats({ projectRoot: root, env: {} });
    expect(s.path).toBe(spoolPath(root, {}));
    expect(s.events).toBe(1);
    expect(s.bytes).toBeGreaterThan(0);
    expect(s.pending_batches).toBe(0);
  });

  it('reports zeroes rather than throwing when nothing has been spooled', () => {
    const root = workspace();
    expect(spool.stats({ projectRoot: root, env: {} }))
      .toEqual({ path: spoolPath(root, {}), bytes: 0, events: 0, pending_batches: 0 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest tests/unit/observe/spool.test.js tests/unit/observe/paths.test.js
```

Expected: `Cannot find module '../../../src/observe/spool'` and `spoolPath is not a function`.

- [ ] **Step 3: Write the implementations**

In `src/observe/paths.js`, add the name beside the other two and a resolver beside `daemonEventLogPath`:

```js
const SPOOL_NAME = 'telemetry.spool';
```

```js
// The telemetry queue. Deliberately NOT a .ndjson name even though its content
// is NDJSON: TROUBLESHOOTING.md documents `cat mobile-automator/.logs/*.ndjson`
// as the merged CLI+daemon timeline, and the spool is not part of that timeline
// — it is a queue that gets renamed out from under a reader mid-flush. The
// extension is the interface that keeps the two apart.
function spoolPath(projectRoot, env = process.env) {
  return path.join(logsDir(projectRoot, env), SPOOL_NAME);
}
```

Add `SPOOL_NAME` and `spoolPath` to `module.exports`.

Create `src/observe/spool.js`:

```js
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
// mauto runs from wherever a user is standing, and a queue of telemetry in an
// unrelated repo is litter that `git add -A` would sweep up.
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

// Atomic hand-off from "being appended to" to "being sent".
//
// renameSync within a directory is atomic, and it loses nothing: appendFileSync
// opens by path and closes per call, so a verb that opened its fd BEFORE the
// rename writes into the claimed inode (that line ships with this batch) and a
// verb that opens AFTER creates a fresh spool. There is no window in which a
// line lands nowhere, and no truncate that could clobber a concurrent writer.
function claim({ projectRoot, env = process.env, fs = realFs } = {}) {
  const source = spoolPath(projectRoot, env);
  const target = `${source}${CLAIM_SUFFIX}.${process.pid}.${Date.now()}`;
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest tests/unit/observe
```

- [ ] **Step 5: Commit**

```bash
git add src/observe/spool.js src/observe/paths.js tests/unit/observe/spool.test.js tests/unit/observe/paths.test.js
git commit -m "feat(observe): the append-only telemetry spool

The spooled line IS the network payload, so a device serial is never written to
the file that gets uploaded. Capped rather than rotated: rotating a queue
silently discards records that were pending delivery."
```

---

### Task 5: Wire the spool into `defaultSinks` — and prove it is unreachable while disabled

One edit to the existing sink list, which is what makes this cover both the CLI (`record()` in `finish()`) and the daemon (`boundRecorder` in `bin/mauto-session-daemon.js`) at once. A second sink-list would be the "duplicating mechanism to change a binding" defect two reviews have already flagged on this branch.

**Files:**
- Modify: `src/observe/recorder.js:33-41` (`defaultSinks`)
- Test: `tests/unit/observe/recorder.test.js` (extend)

**Interfaces:**
- Consumes: `decideForProject` from `src/observe/telemetry.js`; `write`, `SPOOL_LEVEL` from `src/observe/spool.js`.
- Produces: `defaultSinks` returns 2 sinks when telemetry is disabled, 3 when enabled. No signature change.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/observe/recorder.test.js`:

```js
describe('the spool sink is constructed only when telemetry is enabled', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  const { defaultSinks, record } = require('../../../src/observe/recorder');
  const telemetry = require('../../../src/observe/telemetry');
  const { spoolPath } = require('../../../src/observe/paths');

  const TOKEN = { MAUTO_TELEMETRY_TOKEN: 'phc_real' };

  function workspace(config) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-sinks-'));
    fs.mkdirSync(path.join(root, 'mobile-automator'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'mobile-automator', 'config.json'),
      JSON.stringify(config, null, 2)
    );
    return root;
  }

  beforeEach(() => telemetry._resetMemo());

  it('builds two sinks while telemetry is off', () => {
    const root = workspace({ telemetry: { enabled: false } });
    expect(defaultSinks(root, TOKEN)).toHaveLength(2);
  });

  it('builds three once a human has opted in', () => {
    const root = workspace({ telemetry: { enabled: true } });
    expect(defaultSinks(root, TOKEN)).toHaveLength(3);
  });

  it('writes no spool file at all while disabled, at EVERY level', () => {
    const root = workspace({ telemetry: { enabled: false } });
    for (const level of ['debug', 'info', 'warn', 'error']) {
      record({ level, src: 'cli', event: 'verb.end', verb: 'tap', ok: true }, { projectRoot: root, env: { ...TOKEN, MAUTO_LOG_LEVEL: 'debug' } });
    }
    expect(fs.existsSync(spoolPath(root, {}))).toBe(false);
  });

  it('spools info and above, never debug', () => {
    const root = workspace({ telemetry: { enabled: true } });
    record({ level: 'debug', src: 'cli', event: 'call.start', verb: 'tap' }, { projectRoot: root, env: { ...TOKEN, MAUTO_LOG_LEVEL: 'debug' } });
    expect(fs.existsSync(spoolPath(root, {}))).toBe(false);

    record({ level: 'info', src: 'cli', event: 'verb.end', verb: 'tap', ok: true }, { projectRoot: root, env: { ...TOKEN, MAUTO_LOG_LEVEL: 'debug' } });
    expect(fs.readFileSync(spoolPath(root, {}), 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('keeps spooling when MAUTO_LOG_LEVEL=silent — silencing logs is not withdrawing consent', () => {
    const root = workspace({ telemetry: { enabled: true } });
    record({ level: 'info', src: 'cli', event: 'verb.end', verb: 'tap', ok: true }, { projectRoot: root, env: { ...TOKEN, MAUTO_LOG_LEVEL: 'silent' } });
    expect(fs.existsSync(spoolPath(root, {}))).toBe(true);
  });

  it('lets a kill switch override an enabled config with no spool file created', () => {
    const root = workspace({ telemetry: { enabled: true } });
    record({ level: 'info', src: 'cli', event: 'verb.end', verb: 'tap', ok: true }, { projectRoot: root, env: { ...TOKEN, MAUTO_TELEMETRY: '0' } });
    expect(fs.existsSync(spoolPath(root, {}))).toBe(false);

    telemetry._resetMemo();
    record({ level: 'info', src: 'cli', event: 'verb.end', verb: 'tap', ok: true }, { projectRoot: root, env: { ...TOKEN, DO_NOT_TRACK: '1' } });
    expect(fs.existsSync(spoolPath(root, {}))).toBe(false);
  });

  it('survives a throwing spool sink without depriving its neighbours', () => {
    const seen = [];
    record(
      { level: 'info', src: 'cli', event: 'verb.end', ok: true },
      {
        projectRoot: '/nope',
        env: {},
        sinks: [
          { threshold: 'info', write: () => { throw new Error('spool exploded'); } },
          { threshold: 'info', write: (e) => seen.push(e) },
        ],
      }
    );
    expect(seen).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest tests/unit/observe/recorder.test.js
```

Expected: the three-sink and spool-file assertions fail; `defaultSinks` still returns 2 unconditionally.

- [ ] **Step 3: Write the implementation**

In `src/observe/recorder.js`, add the requires:

```js
const spoolSink = require('./spool');
const { decideForProject } = require('./telemetry');
```

and replace the body of `defaultSinks`:

```js
function defaultSinks(projectRoot, env, { logPath } = {}) {
  const levels = resolveLevels(env);
  const sinks = [
    { threshold: levels.stderr, write: (e) => stderrSink.write(e) },
    { threshold: levels.file, write: (e) => fileSink.write(e, { projectRoot, env, logPath }) },
  ];

  // The spool is the ONLY path by which an event can leave this machine, so it
  // is not merely level-gated — it is not CONSTRUCTED at all until a human has
  // opted in. While telemetry is off there is no spool file, which means there
  // is nothing for a flusher to find even if one ran. That is the first of the
  // three layers behind "no upload path is reachable while disabled"; the other
  // two are flush()'s own early return and the one-file transport lint guard.
  //
  // Its threshold is spool.SPOOL_LEVEL, deliberately NOT levels.file: telemetry
  // has its own control, so MAUTO_LOG_LEVEL=debug must not multiply what leaves
  // the machine by 40x, and MAUTO_LOG_LEVEL=silent must not be read as consent
  // withdrawal (there is an explicit control for that).
  //
  // decideForProject memoises per project root — one config.json read per
  // process, not one per event. See src/observe/telemetry.js.
  if (decideForProject(projectRoot, env).enabled) {
    sinks.push({
      threshold: spoolSink.SPOOL_LEVEL,
      write: (e) => spoolSink.write(e, { projectRoot, env }),
    });
  }

  return sinks;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest tests/unit/observe tests/unit/cli.test.js tests/unit/bin
```

The CLI and daemon suites are included on purpose: `defaultSinks` is on both hot paths and this is the one edit that touches them both.

- [ ] **Step 5: Commit**

```bash
git add src/observe/recorder.js tests/unit/observe/recorder.test.js
git commit -m "feat(observe): add the spool as a third sink, built only when opted in

One edit to the existing sink list covers the CLI and the daemon, because
bin/mauto-session-daemon.js already builds its recorder through defaultSinks.
While telemetry is off the sink is never constructed, so no spool file exists."
```

---

### Task 6: `flush.js` — claim, post, delete, back off

The only caller of `transport.js`. Everything about at-least-once delivery and long-offline behaviour lives here.

**Files:**
- Create: `src/observe/flush.js`
- Test: `tests/unit/observe/flush.test.js` (create)

**Interfaces:**
- Consumes: `claim`, `listClaimed`, `readBatch` from `src/observe/spool.js`; `postBatch` from `src/observe/transport.js`; `decideForProject` from `src/observe/telemetry.js`.
- Produces:
  - `flush.BATCH_SIZE: 250`
  - `flush.FLUSH_INTERVAL_MS: 60000`
  - `flush.MAX_FLUSH_INTERVAL_MS: 1800000`
  - `flush.MAX_CLAIMED: 3`
  - `flush.makeFlusher({ projectRoot, env, transport, observe, fs }) => () => Promise<Result>`
  - `Result = { skipped?: string, sent: number, dropped: number, kept: number, ok: boolean, nextDelayMs: number }`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/observe/flush.test.js`:

```js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { makeFlusher, FLUSH_INTERVAL_MS, MAX_FLUSH_INTERVAL_MS, MAX_CLAIMED } = require('../../../src/observe/flush');
const spool = require('../../../src/observe/spool');
const { spoolPath } = require('../../../src/observe/paths');
const telemetry = require('../../../src/observe/telemetry');

const TOKEN = { MAUTO_TELEMETRY_TOKEN: 'phc_real' };

function workspace({ enabled = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-flush-'));
  fs.mkdirSync(path.join(root, 'mobile-automator'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'mobile-automator', 'config.json'),
    JSON.stringify({ telemetry: { enabled } }, null, 2)
  );
  return root;
}

function spoolN(root, n) {
  for (let i = 0; i < n; i++) {
    spool.write({ level: 'info', src: 'cli', event: 'verb.end', verb: 'tap', ok: true }, { projectRoot: root, env: {} });
  }
}

function stubTransport(results) {
  const calls = [];
  const queue = [...results];
  return {
    calls,
    postBatch: async (payloads) => {
      calls.push(payloads);
      return queue.length > 1 ? queue.shift() : queue[0];
    },
  };
}

const OK = { ok: true, retry: false, status: 200 };
const RETRY = { ok: false, retry: true, status: 503 };
const PERMANENT = { ok: false, retry: false, status: 401 };

beforeEach(() => telemetry._resetMemo());

describe('telemetry flush', () => {
  it('never touches the transport while telemetry is disabled', async () => {
    const root = workspace({ enabled: false });
    const transport = {
      postBatch: () => {
        throw new Error('the transport must not be reachable while telemetry is disabled');
      },
    };
    const flush = makeFlusher({ projectRoot: root, env: TOKEN, transport });
    await expect(flush()).resolves.toMatchObject({ skipped: 'not_configured', sent: 0 });
  });

  it('never touches the transport under a kill switch, even with an enabled config', async () => {
    const root = workspace({ enabled: true });
    const transport = {
      postBatch: () => {
        throw new Error('the transport must not be reachable under MAUTO_TELEMETRY=0');
      },
    };
    const flush = makeFlusher({ projectRoot: root, env: { ...TOKEN, MAUTO_TELEMETRY: '0' }, transport });
    await expect(flush()).resolves.toMatchObject({ skipped: 'kill_switch', sent: 0 });
  });

  it('claims, posts and deletes', async () => {
    const root = workspace();
    spoolN(root, 3);
    const transport = stubTransport([OK]);

    const r = await makeFlusher({ projectRoot: root, env: TOKEN, transport })();

    expect(r).toMatchObject({ ok: true, sent: 3, dropped: 0, kept: 0 });
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]).toHaveLength(3);
    expect(fs.existsSync(spoolPath(root, {}))).toBe(false);
    expect(spool.listClaimed({ projectRoot: root, env: {} })).toEqual([]);
  });

  it('is a no-op with an empty spool', async () => {
    const root = workspace();
    const transport = stubTransport([OK]);
    const r = await makeFlusher({ projectRoot: root, env: TOKEN, transport })();
    expect(r).toMatchObject({ ok: true, sent: 0, kept: 0 });
    expect(transport.calls).toHaveLength(0);
  });

  it('keeps the claimed batch on a retryable failure and re-sends it next flush', async () => {
    const root = workspace();
    spoolN(root, 2);
    const transport = stubTransport([RETRY, OK]);
    const flush = makeFlusher({ projectRoot: root, env: TOKEN, transport });

    const first = await flush();
    expect(first).toMatchObject({ ok: false, sent: 0, kept: 1 });
    expect(spool.listClaimed({ projectRoot: root, env: {} })).toHaveLength(1);

    const second = await flush();
    expect(second).toMatchObject({ ok: true, sent: 2, kept: 0 });
    expect(spool.listClaimed({ projectRoot: root, env: {} })).toEqual([]);
  });

  it('drops a permanently-rejected batch so a revoked token cannot wedge the queue', async () => {
    const root = workspace();
    spoolN(root, 2);
    const transport = stubTransport([PERMANENT]);
    const r = await makeFlusher({ projectRoot: root, env: TOKEN, transport })();
    expect(r).toMatchObject({ ok: false, sent: 0, dropped: 2, kept: 0 });
    expect(spool.listClaimed({ projectRoot: root, env: {} })).toEqual([]);
  });

  it('backs off on repeated failure and resets on success', async () => {
    const root = workspace();
    const transport = stubTransport([RETRY]);
    const flush = makeFlusher({ projectRoot: root, env: TOKEN, transport });

    spoolN(root, 1);
    expect((await flush()).nextDelayMs).toBe(FLUSH_INTERVAL_MS * 2);
    expect((await flush()).nextDelayMs).toBe(FLUSH_INTERVAL_MS * 4);
    expect((await flush()).nextDelayMs).toBe(FLUSH_INTERVAL_MS * 8);

    const ok = makeFlusher({ projectRoot: root, env: TOKEN, transport: stubTransport([OK]) });
    expect((await ok()).nextDelayMs).toBe(FLUSH_INTERVAL_MS);
  });

  it('caps the backoff at half an hour', async () => {
    const root = workspace();
    spoolN(root, 1);
    const flush = makeFlusher({ projectRoot: root, env: TOKEN, transport: stubTransport([RETRY]) });
    let delay = 0;
    for (let i = 0; i < 20; i++) delay = (await flush()).nextDelayMs;
    expect(delay).toBe(MAX_FLUSH_INTERVAL_MS);
  });

  it('retries leftover batches before claiming a fresh one, oldest first', async () => {
    const root = workspace();
    spoolN(root, 1);
    await makeFlusher({ projectRoot: root, env: TOKEN, transport: stubTransport([RETRY]) })();

    spoolN(root, 1);
    const transport = stubTransport([OK]);
    const r = await makeFlusher({ projectRoot: root, env: TOKEN, transport })();

    expect(r).toMatchObject({ ok: true, sent: 2 });
    expect(transport.calls).toHaveLength(2); // the leftover, then the fresh claim
  });

  it('prunes claimed batches beyond the cap so a permanently-offline machine converges', async () => {
    const root = workspace();
    const failing = makeFlusher({ projectRoot: root, env: TOKEN, transport: stubTransport([RETRY]) });
    for (let i = 0; i < MAX_CLAIMED + 4; i++) {
      spoolN(root, 1);
      await failing();
    }
    expect(spool.listClaimed({ projectRoot: root, env: {} }).length).toBeLessThanOrEqual(MAX_CLAIMED);
  });

  it('chunks a large batch and stops at the first retryable chunk', async () => {
    const root = workspace();
    spoolN(root, 600); // > 2 * BATCH_SIZE
    const transport = stubTransport([OK, RETRY, OK]);
    const r = await makeFlusher({ projectRoot: root, env: TOKEN, transport })();
    expect(transport.calls.map((c) => c.length)).toEqual([250, 250]);
    expect(r).toMatchObject({ ok: false, sent: 250, kept: 1 });
  });

  it('records its own outcome locally at debug — a user\'s flaky wifi is not a daemon failure', async () => {
    const root = workspace();
    spoolN(root, 2);
    const seen = [];
    await makeFlusher({
      projectRoot: root,
      env: TOKEN,
      transport: stubTransport([RETRY]),
      observe: (e) => seen.push(e),
    })();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ level: 'debug', event: 'telemetry.flush', ok: false, count: 2, http_status: 503 });
  });

  it('never rejects, whatever the transport does', async () => {
    const root = workspace();
    spoolN(root, 1);
    const transport = {
      postBatch: async () => {
        throw new Error('transport blew up in a way postBatch was supposed to catch');
      },
    };
    await expect(makeFlusher({ projectRoot: root, env: TOKEN, transport })()).resolves.toMatchObject({ ok: false });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest tests/unit/observe/flush.test.js
```

Expected: `Cannot find module '../../../src/observe/flush'`.

- [ ] **Step 3: Write the implementation**

Create `src/observe/flush.js`:

```js
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
      return { skipped: decision.reason, sent: 0, dropped: 0, kept: 0, ok: true, nextDelayMs };
    }

    const startedAt = Date.now();
    let sent = 0;
    let dropped = 0;
    let kept = 0;
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
        ok: !retryable,
        count: sent + dropped,
        http_status: lastStatus || undefined,
        dur_ms: Date.now() - startedAt,
      });
    }

    return { sent, dropped, kept, ok: !retryable, nextDelayMs };
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest tests/unit/observe
```

- [ ] **Step 5: Commit**

```bash
git add src/observe/flush.js tests/unit/observe/flush.test.js
git commit -m "feat(observe): drain the spool with claim-then-delete

Delivery is at-least-once and msg_id is what makes that safe. Rewriting the
claimed file with the unsent remainder would be a write on the failure path
whose failure mode is losing records rather than duplicating them."
```

---

### Task 7: The daemon's idle flush

The daemon is the only process in the system with an event loop and a genuine idle window. The seam mirrors `observe` exactly: injected, defaulting to a no-op, so the ~40 in-process daemon unit tests never do network work and never need to know this exists.

**Files:**
- Modify: `src/device/session-daemon.js:155-171` (signature), `:337-352` (beside `armIdle`), `:360+` (`stop`), `:625` (after `armIdle()`)
- Modify: `bin/mauto-session-daemon.js:112` (build and inject the flusher)
- Test: `tests/unit/device/daemon-telemetry-flush.test.js` (create)
- Test: `tests/unit/bin/mauto-session-daemon-observe.test.js` (extend)

**Interfaces:**
- Consumes: `makeFlusher` from `src/observe/flush.js`.
- Produces: `startDaemon` accepts `flush` (default `null`) and `flushIntervalMs` (default `FLUSH_INTERVAL_MS`). No change to its return value.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/device/daemon-telemetry-flush.test.js`:

```js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { startDaemon } = require('../../../src/device/session-daemon');

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-dflush-'));
  fs.mkdirSync(path.join(root, 'mobile-automator'), { recursive: true });
  return root;
}

// The daemon's existing in-process test harness shape: a fake createCall so no
// mobile-mcp child is spawned.
const createCall = async () => ({
  call: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
  close: async () => {},
});

describe('daemon telemetry flush', () => {
  jest.useFakeTimers();
  afterEach(() => jest.clearAllTimers());

  it('does nothing at all when no flusher is injected', async () => {
    const root = workspace();
    const d = await startDaemon({ projectRoot: root, createCall, idleMs: 0 });
    // No timer, no seam, no behaviour change for the ~40 in-process tests.
    jest.advanceTimersByTime(10 * 60 * 1000);
    await d.stop('shutdown');
    expect(true).toBe(true);
  });

  it('runs the injected flusher on its own timer, unref\'d so it cannot hold the loop open', async () => {
    const root = workspace();
    const calls = [];
    const flush = async () => {
      calls.push(Date.now());
      return { ok: true, nextDelayMs: 1000 };
    };

    const d = await startDaemon({ projectRoot: root, createCall, idleMs: 0, flush, flushIntervalMs: 1000 });
    await jest.advanceTimersByTimeAsync(3500);
    expect(calls.length).toBeGreaterThanOrEqual(3);
    await d.stop('shutdown');
  });

  it('re-arms with the delay the flusher asked for, so backoff actually backs off', async () => {
    const root = workspace();
    const delays = [8000, 16000, 16000];
    let i = 0;
    const flush = async () => ({ ok: false, nextDelayMs: delays[Math.min(i++, delays.length - 1)] });

    const d = await startDaemon({ projectRoot: root, createCall, idleMs: 0, flush, flushIntervalMs: 4000 });
    await jest.advanceTimersByTimeAsync(4000);   // first fire
    await jest.advanceTimersByTimeAsync(7999);   // not yet — it asked for 8000
    expect(i).toBe(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(i).toBe(2);
    await d.stop('shutdown');
  });

  it('skips a tick while a device call is in flight rather than competing with it', async () => {
    const root = workspace();
    let released;
    const gate = new Promise((r) => { released = r; });
    const slowCreateCall = async () => ({ call: async () => { await gate; return { content: [] }; }, close: async () => {} });

    let flushes = 0;
    const flush = async () => { flushes++; return { ok: true, nextDelayMs: 1000 }; };

    const d = await startDaemon({
      projectRoot: root, createCall: slowCreateCall, idleMs: 0, flush, flushIntervalMs: 1000,
    });
    // Simulated in-flight work is exercised through the daemon's own socket in
    // the integration suite; here the property under test is that the timer is
    // armed and re-arms, and that stop() clears it.
    await jest.advanceTimersByTimeAsync(2500);
    expect(flushes).toBeGreaterThanOrEqual(2);
    released();
    await d.stop('shutdown');
  });

  it('stops flushing once the daemon is stopping', async () => {
    const root = workspace();
    let flushes = 0;
    const flush = async () => { flushes++; return { ok: true, nextDelayMs: 1000 }; };

    const d = await startDaemon({ projectRoot: root, createCall, idleMs: 0, flush, flushIntervalMs: 1000 });
    await jest.advanceTimersByTimeAsync(1000);
    const seen = flushes;
    await d.stop('shutdown');
    await jest.advanceTimersByTimeAsync(10000);
    expect(flushes).toBe(seen);
  });

  it('a throwing flusher never takes the daemon down', async () => {
    const root = workspace();
    const flush = async () => { throw new Error('flusher exploded'); };
    const d = await startDaemon({ projectRoot: root, createCall, idleMs: 0, flush, flushIntervalMs: 500 });
    await jest.advanceTimersByTimeAsync(2000);
    await expect(d.stop('shutdown')).resolves.toBeUndefined();
  });
});
```

Append to `tests/unit/bin/mauto-session-daemon-observe.test.js`:

```js
describe('the daemon process builds a real flusher', () => {
  it('injects a flush seam into startDaemon', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', '..', 'bin', 'mauto-session-daemon.js'),
      'utf8'
    );
    // The seam must be WIRED, not merely importable: an unwired flusher is a
    // spool that grows forever and a feature that silently does nothing.
    expect(src).toMatch(/makeFlusher\(/);
    expect(src).toMatch(/startDaemon\(\{[^}]*flush/s);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest tests/unit/device/daemon-telemetry-flush.test.js tests/unit/bin/mauto-session-daemon-observe.test.js
```

Expected: the flusher never runs — `startDaemon` ignores the unknown `flush` option.

- [ ] **Step 3: Write the implementation**

In `src/device/session-daemon.js`, add to the `startDaemon` destructure, beside `observe`:

```js
  // The spool flusher. Injected and defaulting to null for exactly the reason
  // `observe` is: startDaemon runs IN-PROCESS across ~40 unit tests, and a
  // default that reached the real flusher would put network I/O in the unit
  // suite. bin/mauto-session-daemon.js — the only process that is actually a
  // daemon — injects the real one.
  flush = null,
  flushIntervalMs = FLUSH_INTERVAL_MS,
```

with `const { FLUSH_INTERVAL_MS } = require('../observe/flush');` at the top of the file.

Beside `armIdle`, add:

```js
  let flushTimer = null;

  function clearFlush() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  // Why the daemon does this at all: a one-shot verb cannot. process.exit()
  // tears down a pending socket, so a verb's POST is dropped a large fraction
  // of the time. The daemon is the only process here with an event loop, and
  // between device calls it is doing nothing at all.
  //
  // A self-rescheduling setTimeout rather than setInterval: the flusher returns
  // the delay it wants (exponential backoff on a retryable failure, reset on
  // success), and setInterval cannot express that. unref'd, so a pending flush
  // can never hold the process open past its idle reap or delay a stop().
  //
  // In-flight device calls are skipped rather than competed with — the flush is
  // strictly lower priority than the device work the user is waiting on, and
  // the very next tick picks it up.
  function armFlush(delayMs) {
    clearFlush();
    if (!flush || stopping) return;
    if (!(delayMs > 0) || !Number.isFinite(delayMs)) return;
    flushTimer = setTimeout(async () => {
      if (stopping) return;
      if (inFlight > 0) {
        armFlush(delayMs);
        return;
      }
      let next = delayMs;
      try {
        const r = await flush();
        if (r && Number.isFinite(r.nextDelayMs) && r.nextDelayMs > 0) next = r.nextDelayMs;
      } catch (_) {
        // A telemetry fault is never worth a device session. makeFlusher is
        // already total; this is that guarantee restated as a property of the
        // DAEMON rather than of its current caller.
      }
      armFlush(next);
    }, delayMs);
    if (typeof flushTimer.unref === 'function') flushTimer.unref();
  }
```

In `stop()`, immediately after the existing `clearIdle();`:

```js
    clearFlush();
```

And after the existing `armIdle();` near the end of `startDaemon`:

```js
  armFlush(flushIntervalMs);
```

In `bin/mauto-session-daemon.js`, add the require:

```js
const { makeFlusher } = require('../src/observe/flush');
```

and build the flusher beside the recorder in `main()`, then inject it:

```js
  // The recorder's counterpart: the one process here with an event loop is the
  // one that does the network. Built with the same `observe` it records
  // through, so a flush outcome lands in daemon.ndjson next to the events it
  // was trying to deliver. Construction is guarded for the same reason
  // buildRecorder's is — a telemetry fault must never stop a daemon starting.
  let flush = null;
  try {
    flush = makeFlusher({ projectRoot, env: process.env, observe });
  } catch (_) {
    flush = null;
  }

  daemon = await startDaemon({ projectRoot, device, idleMs, sessionId, observe, flush });
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest tests/unit/device/daemon-telemetry-flush.test.js tests/unit/bin
```

- [ ] **Step 5: Run every daemon suite — this modifies a hot file**

```bash
npx jest tests/unit/device tests/integration
```

Expected: all green, and in particular the ~40 pre-existing in-process `startDaemon` tests are unchanged, because `flush` defaults to `null` and arms no timer.

- [ ] **Step 6: Commit**

```bash
git add src/device/session-daemon.js bin/mauto-session-daemon.js tests/unit/device/daemon-telemetry-flush.test.js tests/unit/bin/mauto-session-daemon-observe.test.js
git commit -m "feat(daemon): flush the telemetry spool during the idle window

Injected and defaulting to null, exactly like the observe seam, so the ~40
in-process startDaemon tests do no network work. Self-rescheduling setTimeout
rather than setInterval, because the flusher returns the delay it wants."
```

---

### Task 8: The `mauto telemetry` verb — status, enable, disable, flush

The consent surface, and the escape hatch for a user with no daemon running.

`status` is the interesting one: it renders the field list **from `EVENT_FIELDS` at runtime**, so the disclosure a user reads before opting in cannot drift from what the uploader actually sends. That is the same idiom as `action-catalog` and `capability-catalog`, applied to a privacy notice.

**Files:**
- Modify: `src/cli.js` (four handlers + the verb registration, beside the `session` group at `:1588`)
- Test: `tests/unit/cli.test.js` (extend)
- Test: `tests/integration/stdout-purity.test.js` (extend)

**Interfaces:**
- Consumes: `telemetry`, `spool`, `flush`, `transport` from `src/observe/`; `configManager`.
- Produces: verbs `telemetry status`, `telemetry enable`, `telemetry disable`, `telemetry flush`, each emitting the standard envelope.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/cli.test.js`:

```js
describe('mauto telemetry', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  const { handleTelemetryStatus, handleTelemetryEnable, handleTelemetryDisable } = require('../../src/cli');
  const telemetryModule = require('../../src/observe/telemetry');
  const { EVENT_FIELDS, NEVER_SENDS } = require('../../src/observe/event');

  function workspace(config = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-tv-'));
    fs.mkdirSync(path.join(root, 'mobile-automator'), { recursive: true });
    fs.writeFileSync(path.join(root, 'mobile-automator', 'config.json'), JSON.stringify(config, null, 2));
    return root;
  }

  beforeEach(() => telemetryModule._resetMemo());

  it('reports off, and says exactly how to turn it on', () => {
    const root = workspace({});
    const { envelope, exitKind } = handleTelemetryStatus({ projectRoot: root, env: {} });
    expect(exitKind).toBe('ok');
    expect(envelope.ok).toBe(true);
    expect(envelope.data.enabled).toBe(false);
    expect(envelope.data.reason).toBe('not_configured');
    expect(envelope.data.enable_with).toBe('mauto telemetry enable');
  });

  it('renders the field list from the catalog, not from prose', () => {
    const root = workspace({});
    const { envelope } = handleTelemetryStatus({ projectRoot: root, env: {} });
    expect(envelope.data.fields_sent.sort())
      .toEqual(Object.keys(EVENT_FIELDS).filter((k) => EVENT_FIELDS[k].sends).sort());
    expect(envelope.data.fields_never_sent.sort()).toEqual([...NEVER_SENDS].sort());
    expect(envelope.data.notice).toBe(telemetryModule.CONSENT_NOTICE);
  });

  it('reports the spool so a user can see what is queued before opting in', () => {
    const root = workspace({});
    const { envelope } = handleTelemetryStatus({ projectRoot: root, env: {} });
    expect(envelope.data.spool).toEqual({
      path: expect.stringContaining('telemetry.spool'),
      bytes: 0,
      events: 0,
      pending_batches: 0,
    });
  });

  it('enable writes the config key', () => {
    const root = workspace({});
    const { envelope } = handleTelemetryEnable({ projectRoot: root, env: { MAUTO_TELEMETRY_TOKEN: 'phc_real' } });
    expect(envelope.ok).toBe(true);
    expect(envelope.data.enabled).toBe(true);
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'mobile-automator', 'config.json'), 'utf8'));
    expect(cfg.telemetry.enabled).toBe(true);
  });

  it('enable under a kill switch writes the intent but does NOT claim to be on', () => {
    const root = workspace({});
    const { envelope } = handleTelemetryEnable({
      projectRoot: root,
      env: { MAUTO_TELEMETRY_TOKEN: 'phc_real', MAUTO_TELEMETRY: '0' },
    });
    expect(envelope.ok).toBe(true);
    expect(envelope.data.enabled).toBe(false);
    expect(envelope.data.reason).toBe('kill_switch');
    expect(envelope.hint).toMatch(/MAUTO_TELEMETRY/);
    // The durable intent is still recorded — the env var is this shell's
    // override, not a rewrite of what the project owner asked for.
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'mobile-automator', 'config.json'), 'utf8'));
    expect(cfg.telemetry.enabled).toBe(true);
  });

  it('disable writes false and reports off', () => {
    const root = workspace({ telemetry: { enabled: true } });
    const { envelope } = handleTelemetryDisable({ projectRoot: root, env: {} });
    expect(envelope.data.enabled).toBe(false);
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'mobile-automator', 'config.json'), 'utf8'));
    expect(cfg.telemetry.enabled).toBe(false);
  });
});
```

Append to `tests/integration/stdout-purity.test.js`, inside the existing envelope-verb table (add the four new invocations to whatever list that suite iterates):

```js
  // Telemetry verbs are envelope verbs like every other. `flush` is the ONE
  // verb permitted a network round trip, and it is run here with a kill switch
  // set so the suite never reaches the wire while still exercising the path.
  ['telemetry', 'status'],
  ['telemetry', 'enable'],
  ['telemetry', 'disable'],
  ['telemetry', 'flush'],
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest tests/unit/cli.test.js -t telemetry
```

Expected: `handleTelemetryStatus is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/cli.js`, add the requires beside the existing `record` import:

```js
const observeTelemetry = require('./observe/telemetry');
const observeSpool = require('./observe/spool');
const observeTransport = require('./observe/transport');
const { makeFlusher } = require('./observe/flush');
```

Add the handlers beside the other workspace handlers:

```js
// --- Slice 5: telemetry consent surface -----------------------------------
//
// `status` is the informed half of informed consent, and it is COMPUTED: the
// field lists come from EVENT_FIELDS at runtime, so the disclosure a user reads
// before opting in cannot drift from what the uploader actually sends. Prose
// that restates a catalog is prose that will eventually be wrong.

function telemetryReport({ projectRoot, env }, extra = {}) {
  const decision = observeTelemetry.decideForProject(projectRoot, env);
  return {
    enabled: decision.enabled,
    reason: decision.reason,
    endpoint: observeTransport.endpointUrl(env),
    fields_sent: observeTelemetry.sentFields(),
    fields_never_sent: observeTelemetry.neverSentFields(),
    spool: observeSpool.stats({ projectRoot, env }),
    notice: observeTelemetry.CONSENT_NOTICE,
    enable_with: 'mauto telemetry enable',
    ...extra,
  };
}

function handleTelemetryStatus({ projectRoot, env = process.env }) {
  return { envelope: ok(telemetryReport({ projectRoot, env })), exitKind: 'ok' };
}

// Writes the durable intent, then reports the RESOLVED state — which may still
// be off, because an env kill switch wins. Reporting `enabled: true` here when
// MAUTO_TELEMETRY=0 is set would be a lie, and the config is not the place to
// resolve a conflict the environment owns.
function handleTelemetryEnable({ projectRoot, env = process.env }) {
  configManager.set(projectRoot, 'telemetry.enabled', true);
  observeTelemetry._resetMemo();
  const data = telemetryReport({ projectRoot, env });
  const hint =
    data.reason === 'kill_switch'
      ? 'Telemetry is enabled in config.json but MAUTO_TELEMETRY=0 is set in this environment and overrides it.'
      : data.reason === 'do_not_track'
        ? 'Telemetry is enabled in config.json but DO_NOT_TRACK is set in this environment and overrides it.'
        : data.reason === 'no_token'
          ? 'Telemetry is enabled in config.json but this build ships no project token, so nothing will be sent.'
          : undefined;
  return { envelope: ok(data, hint), exitKind: 'ok' };
}

function handleTelemetryDisable({ projectRoot, env = process.env }) {
  configManager.set(projectRoot, 'telemetry.enabled', false);
  observeTelemetry._resetMemo();
  return { envelope: ok(telemetryReport({ projectRoot, env })), exitKind: 'ok' };
}

// The explicit escape hatch. This is the ONE verb allowed a network round trip,
// because the user asked for one and is willing to wait for it — every other
// verb appends to the spool and exits. A machine that never runs a daemon
// drains here.
async function handleTelemetryFlush({ projectRoot, env = process.env, flusher }) {
  const flush = flusher || makeFlusher({ projectRoot, env });
  const r = await flush();
  return {
    envelope: ok({
      skipped: r.skipped,
      sent: r.sent,
      dropped: r.dropped,
      kept: r.kept,
      spool: observeSpool.stats({ projectRoot, env }),
    }),
    exitKind: 'ok',
  };
}
```

Register the verb group beside `session`:

```js
  // --- Slice 5: telemetry ---------------------------------------------------

  const telemetryCmd = program
    .command('telemetry')
    .description('Inspect and control anonymous usage telemetry (off by default)');

  telemetryCmd
    .command('status')
    .description('Report whether telemetry is on, what would be sent, and what is queued')
    .action(withEnvelope(() => emit(handleTelemetryStatus({ projectRoot }), humanFlag())));

  telemetryCmd
    .command('enable')
    .description('Turn on anonymous usage telemetry')
    .action(withEnvelope(() => emit(handleTelemetryEnable({ projectRoot }), humanFlag())));

  telemetryCmd
    .command('disable')
    .description('Turn off anonymous usage telemetry')
    .action(withEnvelope(() => emit(handleTelemetryDisable({ projectRoot }), humanFlag())));

  telemetryCmd
    .command('flush')
    .description('Upload any spooled telemetry now instead of waiting for the daemon')
    .action(withEnvelope(async () => emit(await handleTelemetryFlush({ projectRoot }), humanFlag())));
```

and add the four handlers to `module.exports`.

**Deliberately not done:** `telemetry` is **not** added to `mauto bootstrap`, to any `guide` topic, or to any installed Agent Skill. Telemetry is a decision for the human who owns the project, not context an agent needs to drive a device — putting it in the reasoning layer would spend agent context on something the agent must never act on. It is documented for humans in `README.md` and `docs/reference/` (Task 10).

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest tests/unit/cli.test.js tests/integration/stdout-purity.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/cli.js tests/unit/cli.test.js tests/integration/stdout-purity.test.js
git commit -m "feat(cli): mauto telemetry status/enable/disable/flush

status renders the field list from EVENT_FIELDS at runtime, so the disclosure a
user reads cannot drift from what the uploader sends. enable under a kill
switch records the intent and reports honestly that it is still off."
```

---

### Task 9: The config key, the schema, and the scaffolded default

`telemetry.enabled: false` is written **literally** into the config `mauto setup` scaffolds. An absent key that happens to default off is not discoverable; a visible `false` is. Discoverability is part of consent.

**Files:**
- Modify: `src/schemas/config_schema.json` (add the `telemetry` object)
- Modify: `src/setup/scaffold.js:49-56` (the skeleton)
- Modify: `src/cli.js` `handleSetup` (surface the notice in the envelope)
- Test: `tests/unit/setup/*.test.js` (extend)
- Test: `tests/lint/config-schema.test.js` (passes unchanged — it validates the skeleton against the schema, which is exactly the drift this guards)

**Interfaces:**
- Consumes: `CONSENT_NOTICE` from `src/observe/telemetry.js`.
- Produces: config key `telemetry.enabled` (boolean); `handleSetup`'s envelope `data` gains `telemetry`.

- [ ] **Step 1: Write the failing tests**

Append to the setup unit suite (`tests/unit/setup/scaffold.test.js`):

```js
describe('telemetry default', () => {
  it('writes a visible false rather than relying on an absent key', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-setup-tel-'));
    scaffold(root, { mode: 'platform-aware' });
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'mobile-automator', 'config.json'), 'utf8'));
    expect(cfg.telemetry).toEqual({ enabled: false });
  });

  it('never rewrites an existing config\'s telemetry choice', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-setup-tel2-'));
    fs.mkdirSync(path.join(root, 'mobile-automator'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'mobile-automator', 'config.json'),
      JSON.stringify({ mode: 'platform-aware', telemetry: { enabled: true } }, null, 2)
    );
    scaffold(root, { mode: 'platform-agnostic' });
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'mobile-automator', 'config.json'), 'utf8'));
    // Re-running setup must not silently revoke — or silently grant — consent.
    expect(cfg.telemetry.enabled).toBe(true);
    expect(cfg.mode).toBe('platform-agnostic');
  });
});
```

Append to `tests/unit/cli.test.js`:

```js
it('setup surfaces the telemetry notice in its envelope rather than printing a banner', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-setup-notice-'));
  const { envelope } = require('../../src/cli').handleSetup({ projectRoot: root }, { mode: 'aware' });
  expect(envelope.data.telemetry).toEqual({
    enabled: false,
    notice: require('../../src/observe/telemetry').CONSENT_NOTICE,
  });
});
```

Append to `tests/lint/config-schema.test.js`:

```js
  test('telemetry.enabled is declared boolean, so `config set` coerces "true" rather than storing a string', () => {
    expect(declaredTypesAt('telemetry.enabled')).toContain('boolean');
    expect(validateAt('telemetry.enabled', true)).toMatchObject({ valid: true });
    expect(validateAt('telemetry.enabled', 'true')).toMatchObject({ valid: false });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest tests/unit/setup tests/lint/config-schema.test.js tests/unit/cli.test.js -t telemetry
```

- [ ] **Step 3: Write the implementations**

In `src/schemas/config_schema.json`, add to `properties`:

```json
    "telemetry": {
      "type": "object",
      "additionalProperties": true,
      "description": "Anonymous usage telemetry. Off unless `enabled` is literally true. MAUTO_TELEMETRY=0 and DO_NOT_TRACK=1 override this and always win; MAUTO_TELEMETRY=1 deliberately does not enable. Run `mauto telemetry status` for the exact field list.",
      "properties": {
        "enabled": {
          "type": "boolean",
          "description": "Opt in to anonymous usage telemetry. Default false. Set with `mauto telemetry enable`."
        }
      }
    },
```

In `src/setup/scaffold.js`, extend the skeleton:

```js
    const skeleton = {
      mode,
      project_name: null,
      environments: [],
      default_environment: null,
      // Written as a LITERAL false rather than omitted. An absent key that
      // happens to default off is not discoverable; a visible false is, and
      // discoverability is part of consent. The `else` branch below never
      // touches this key: re-running setup must not silently revoke — or
      // silently grant — a choice the project owner already made.
      telemetry: { enabled: false },
    };
```

In `src/cli.js` `handleSetup`, extend the success envelope:

```js
  return {
    envelope: ok({
      created: r.created,
      mode: r.mode,
      // A NOTICE, not a prompt. mauto verbs are invoked by an agent, so there
      // is nobody at the keyboard to answer a question — and an agent answering
      // a consent question on a human's behalf is worse than not asking. It
      // rides in the envelope (structured, in-band) rather than as a stderr
      // banner, so the agent can surface it to the human it belongs to.
      telemetry: { enabled: false, notice: CONSENT_NOTICE },
      next: 'run `mauto guide setup`',
    }),
    exitKind: 'ok',
  };
```

with `const { CONSENT_NOTICE } = require('./observe/telemetry');` added to the requires.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest tests/unit/setup tests/lint tests/unit/cli.test.js
```

`tests/lint/config-schema.test.js`'s pre-existing "the fresh scaffold skeleton conforms to the schema" case is the one that matters here: it walks every key the skeleton writes and validates it. It passes only because the schema entry and the skeleton were added in the same change, which is exactly what that guard exists to force.

- [ ] **Step 5: Commit**

```bash
git add src/schemas/config_schema.json src/setup/scaffold.js src/cli.js tests/unit/setup tests/lint/config-schema.test.js tests/unit/cli.test.js
git commit -m "feat(setup): scaffold telemetry.enabled false, visibly

An absent key that defaults off is not discoverable; a literal false is, and
discoverability is part of consent. Re-running setup never rewrites an existing
telemetry choice in either direction."
```

---

### Task 10: Privacy documentation, derived from the catalog

Documentation that restates a catalog is documentation that will eventually be wrong. This task writes the privacy page **and** a lint guard that fails the build when the page and `EVENT_FIELDS` disagree.

**Files:**
- Create: `docs/reference/telemetry.md`
- Modify: `mkdocs.yml:86-92` (nav, under Reference)
- Modify: `README.md` (a short section)
- Modify: `docs/reference/cli-verbs.md` (the `telemetry` verb group)
- Test: `tests/lint/telemetry-docs.test.js` (create)

**Interfaces:**
- Consumes: `sentFields`, `neverSentFields` from `src/observe/telemetry.js`.
- Produces: no code.

- [ ] **Step 1: Write the failing test**

Create `tests/lint/telemetry-docs.test.js`:

```js
'use strict';

// Structural guard: the privacy page and the field catalog cannot disagree.
//
// A privacy disclosure is the one document where "slightly out of date" is not
// a documentation bug, it is a false statement about what leaves a user's
// machine. So the page is checked against EVENT_FIELDS in both directions: a
// field that gains a network path and is not documented fails here, and a
// field the page claims is sent while the catalog says otherwise fails too.

const fs = require('fs');
const path = require('path');

const { sentFields, neverSentFields } = require('../../src/observe/telemetry');

const DOC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'docs', 'reference', 'telemetry.md'),
  'utf8'
);

// Field names appear in the page as leading table cells: `| `field` | ... |`
function documented(section) {
  const start = DOC.indexOf(section);
  expect(start).toBeGreaterThan(-1);
  const rest = DOC.slice(start);
  const end = rest.indexOf('\n## ', 1);
  const body = end === -1 ? rest : rest.slice(0, end);
  return new Set([...body.matchAll(/^\|\s*`([a-z_]+)`\s*\|/gm)].map((m) => m[1]));
}

describe('telemetry documentation', () => {
  it('documents every field that can leave the machine', () => {
    const doc = documented('## What is sent');
    expect(sentFields().filter((f) => !doc.has(f))).toEqual([]);
  });

  it('claims no field the catalog does not actually send', () => {
    const doc = documented('## What is sent');
    expect([...doc].filter((f) => !sentFields().includes(f))).toEqual([]);
  });

  it('documents every field that is permanently withheld', () => {
    const doc = documented('## What is never sent');
    expect(neverSentFields().filter((f) => !doc.has(f))).toEqual([]);
  });

  it('states the controls a user needs to find', () => {
    for (const token of [
      'mauto telemetry enable',
      'mauto telemetry disable',
      'mauto telemetry status',
      'MAUTO_TELEMETRY=0',
      'DO_NOT_TRACK',
      'eu.i.posthog.com',
    ]) {
      expect(DOC).toContain(token);
    }
  });

  it('is reachable from the docs site', () => {
    const nav = fs.readFileSync(path.join(__dirname, '..', '..', 'mkdocs.yml'), 'utf8');
    expect(nav).toContain('reference/telemetry.md');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest tests/lint/telemetry-docs.test.js
```

Expected: `ENOENT: docs/reference/telemetry.md`.

- [ ] **Step 3: Write the documentation**

Create `docs/reference/telemetry.md`. The two tables must list exactly the catalog's `sends: true` names and the `NEVER_SENDS` names — read them out of `src/observe/event.js` rather than from memory:

````markdown
# Telemetry & Privacy

`mauto` collects **nothing** unless you turn telemetry on. This page describes
what it would collect if you did, exactly, field by field.

## The short version

- Off by default. No prompt, no banner, no opt-out flow — you turn it on or it
  stays off.
- No free text of any kind ever leaves your machine: no scenario ids, app
  package names, device serials, element labels, typed input or filesystem
  paths.
- No per-machine identifier. There is no install id, no device fingerprint and
  no user id. Events are anonymous and uncorrelated.
- Everything is spooled to a local file first. You can read it before it goes:
  `cat mobile-automator/.logs/telemetry.spool`.

## Turning it on and off

```bash
mauto telemetry status     # what is on, what would be sent, what is queued
mauto telemetry enable     # opt in
mauto telemetry disable    # opt back out
mauto telemetry flush      # upload what is queued now
```

`mauto telemetry enable` writes `telemetry.enabled: true` into
`mobile-automator/config.json`. `mauto config set telemetry.enabled true` does
the same thing.

Two environment variables override the config and always win:

| Variable | Effect |
|---|---|
| `MAUTO_TELEMETRY=0` | Disables telemetry regardless of config. |
| `DO_NOT_TRACK=1` | Disables telemetry regardless of config. |

`MAUTO_TELEMETRY=1` deliberately does **not** enable telemetry. An off-switch is
safe to honour from the environment; an on-switch is a way to turn collection on
for a machine — a CI image, a shared shell profile, an inherited Dockerfile —
whose owner never consented to it. Opting in happens in a file the project owner
edits.

## What is sent

These are the only fields that can ever cross the network. The list is enforced
by `src/observe/event.js`, which builds the payload by iterating this catalog
rather than by iterating the event — so a field nobody has classified is
*dropped*, never sent. `tests/lint/telemetry-docs.test.js` fails the build if
this table and that catalog disagree.

| Field | What it is |
|---|---|
| `ts` | ISO timestamp of the event. |
| `v` | Event schema version. |
| `mauto_version` | The `mauto` version that produced the event. |
| `node` | Node runtime version. |
| `os` | `process.platform` — `darwin`, `linux`, `win32`. |
| `level` | `debug`, `info`, `warn` or `error`. |
| `src` | `cli` or `daemon`. |
| `event` | The event name, e.g. `verb.end`, `call.end`, `daemon.start`. |
| `verb` | The `mauto` verb, taken from commander's resolved command — never from your command line. |
| `ok` | Whether the operation succeeded. |
| `error_kind` | The envelope's error taxonomy: `device`, `timeout`, `invalid_input`, … |
| `exit_code` | The process exit code. |
| `dur_ms` | How long it took. |
| `session_id` | A random id regenerated every time the device daemon starts. Not persisted, not derived from your machine. |
| `tool` | The mobile-mcp primitive behind the verb, checked against a pinned allowlist. |
| `stop_reason` | Why the daemon stopped: `idle`, `signal`, `shutdown`, `crash`, `explicit`. |
| `error_code` | A Node/libuv errno string such as `EACCES`. |
| `msg_id` | A random per-event id used to deduplicate a re-sent batch. Never reused, so it cannot correlate two events. |
| `count` | An integer count, e.g. a batch size. |
| `http_status` | The HTTP status our own telemetry endpoint returned. |

## What is never sent

These fields exist in your **local** logs (`mobile-automator/.logs/`) and are
permanently barred from the network path. `tests/lint/telemetry-redaction.test.js`
fails the build if any of them is reclassified.

| Field | Why it stays local |
|---|---|
| `run_id` | Agent-chosen; routinely names an unreleased feature. |
| `scenario_id` | Names the feature you are testing. |
| `app_id` | An unreleased product's package name. |
| `device_id` | A hardware identifier / serial. |
| `device_model` | Narrows a device to an individual tester. |
| `project_name` | Your project's name. |
| `pid` | No aggregate value, and a weak host correlator alongside a timestamp. |
| `message` | Free text; may embed labels, paths or typed input. |
| `hint` | Free text; may embed filesystem paths. |
| `path` | A filesystem path; leaks usernames and project layout. |

## How it is delivered

Verbs never talk to the network. Every `mauto` verb ends by exiting, which tears
down a pending socket, so a verb that tried to POST would drop the event a large
fraction of the time and a verb that waited for one would add a network round
trip to every tap.

Instead a verb appends one line to `mobile-automator/.logs/telemetry.spool` —
that line is the exact payload that would be uploaded, nothing more — and the
device session daemon uploads it during its idle window. `mauto telemetry flush`
does it on demand. Nothing is retried forever: the spool is capped at 256 KiB,
at most three pending batches are kept, and failed uploads back off from one
minute to thirty.

Data goes to PostHog's EU cloud (`https://eu.i.posthog.com/batch/`) using their
plain HTTP capture API and a write-only public project token. No PostHog SDK is
installed; `mauto` has no analytics dependency.

## Reading the queue yourself

```bash
mauto telemetry status
cat mobile-automator/.logs/telemetry.spool
```

The spool is plain NDJSON — one upload payload per line. If you disagree with
anything in it, `mauto telemetry disable` and delete the file.
````

In `mkdocs.yml`, add under `Reference:` after `Internal Engine (mobile-mcp)`:

```yaml
      - Telemetry & Privacy: reference/telemetry.md
```

In `README.md`, add a short section (near the configuration section) linking to the page — the notice text itself lives in `src/observe/telemetry.js`, so summarise rather than paste:

```markdown
### Telemetry

`mauto` collects nothing by default. Anonymous usage telemetry is opt-in via
`mauto telemetry enable`, sends no free text of any kind, and carries no
per-machine identifier. `MAUTO_TELEMETRY=0` and `DO_NOT_TRACK=1` force it off.
Run `mauto telemetry status` for the exact field list, or read
[Telemetry & Privacy](https://sh3lan93.github.io/mobile-automator/reference/telemetry/).
```

In `docs/reference/cli-verbs.md`, add the four subcommands to the verb table in the same style as the `session` group.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest tests/lint/telemetry-docs.test.js
npm run lint:guides
```

- [ ] **Step 5: Commit**

```bash
git add docs/reference/telemetry.md docs/reference/cli-verbs.md mkdocs.yml README.md tests/lint/telemetry-docs.test.js
git commit -m "docs: telemetry privacy page, guarded against the field catalog

A privacy disclosure that drifts is not a documentation bug, it is a false
statement about what leaves a user's machine, so the page is checked against
EVENT_FIELDS in both directions."
```

---

### Task 11: Remove the `MAUTO_OBSERVE` gate — verify first, then guard it shut

**Read this before writing any code.** As of this branch's `HEAD`, `MAUTO_OBSERVE` **does not exist anywhere in the repository except the two planning documents**. Verified:

```
$ grep -rl MAUTO_OBSERVE . --exclude-dir=node_modules --exclude-dir=.git
docs/plans/2026-08-31-observability-design.md
docs/plans/2026-09-01-observability-slice-2-plan.md
```

Slice 2's plan argued the gate clause applies vacuously to a slice that adds no verb, and shipped ungated. Slices 3 and 4 add verbs (`mauto crash`) and a behaviour change (screenshot-on-failure) and **may** have introduced it. So this task cannot be written as a deletion of a known set of lines. It is: find out what is actually there, remove it, and make the removal permanent with a guard, so the outcome is the same regardless of what slices 3–4 did.

**Files:**
- Modify: whatever Step 1 finds (expected candidates: `src/cli.js`, `src/observe/*`, `src/device/*`, their tests, `README.md`, `TROUBLESHOOTING.md`, `docs/**`)
- Test: `tests/lint/no-observe-gate.test.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: no `MAUTO_OBSERVE` anywhere in `src/`, `bin/`, `tests/` or shipping docs.

- [ ] **Step 1: Find out what is actually gated**

```bash
grep -rn "MAUTO_OBSERVE" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs/plans
```

**Branch A — no hits outside `docs/plans/`.** Nothing to remove. Skip to Step 3 and still add the guard: it converts "slices 3 and 4 correctly chose not to gate" from an accident of history into a build-enforced property. Note the outcome in the Task 12 changelog entry rather than claiming a removal that never happened.

**Branch B — hits in `src/`, `bin/` or `tests/`.** For each site, remove the gate and keep the behaviour it was gating:

- A verb registered only when the gate is set becomes registered unconditionally.
- A branch of the form `if (process.env.MAUTO_OBSERVE) { … }` keeps the `{ … }` and loses the `if`.
- A test that asserts a verb is *absent* without the gate is deleted, not inverted — the absence is what stops being true.
- A test that sets `MAUTO_OBSERVE=1` in its env just drops that key; every assertion after it must still pass.
- Docs and `TROUBLESHOOTING.md` mentions ("set `MAUTO_OBSERVE=1` to try …") are removed, not softened.

Do **not** remove the mentions in `docs/plans/**`. Those are historical records of what was true when they were written, exactly as `tests/lint/docs-counts.test.js` excludes plans for the same reason.

- [ ] **Step 2: Run every suite that touched a gate site**

```bash
npm test
```

The gate's whole purpose was to hide partial states, so removing it is the moment a partial state would become visible. A red suite here is the gate having done its job, not a flaky test.

- [ ] **Step 3: Write the guard**

Create `tests/lint/no-observe-gate.test.js`:

```js
'use strict';

// The observability feature graduated in 0.25.0. MAUTO_OBSERVE was the
// gate-then-graduate env var that kept slices 2-4's partial states invisible on
// main; a graduated feature that still reads it has a hidden second behaviour
// nobody tests, which is the exact failure the gate existed to prevent — just
// moved to the other side of the release.
//
// docs/plans/** is excluded on purpose: those are historical records of what
// was true when they were written, the same exclusion tests/lint/docs-counts
// .test.js makes and for the same reason.

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const ROOTS = ['src', 'bin', 'tests', 'docs/reference', 'docs/guides', 'docs/concepts'];
const FILES = ['README.md', 'TROUBLESHOOTING.md', 'CLAUDE.md'];

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

describe('the MAUTO_OBSERVE gate is gone', () => {
  it('appears in no shipping source, test or doc', () => {
    const candidates = [
      ...ROOTS.flatMap((r) => walk(path.join(REPO, r))),
      ...FILES.map((f) => path.join(REPO, f)).filter((f) => fs.existsSync(f)),
    ];
    const offenders = candidates
      .filter((f) => fs.readFileSync(f, 'utf8').includes('MAUTO_OBSERVE'))
      .map((f) => path.relative(REPO, f));
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 4: Run the guard**

```bash
npx jest tests/lint/no-observe-gate.test.js
npm test
```

- [ ] **Step 5: Commit**

Branch B:

```bash
git add -A
git commit -m "feat(observe): graduate — remove the MAUTO_OBSERVE gate

A graduated feature that still reads its gate has a hidden second behaviour
nobody tests, which is the failure the gate existed to prevent, moved to the
other side of the release. A lint guard keeps it gone."
```

Branch A (nothing was gated):

```bash
git add tests/lint/no-observe-gate.test.js
git commit -m "test(lint): guard that MAUTO_OBSERVE never returns

Slices 1-4 shipped ungated — the gate clause applied vacuously to slices that
added no user-visible verb. This makes that outcome build-enforced rather than
an accident of history."
```

---

### Task 12: Graduation — token, version bump, changelog, verification, PR

Release mechanics. Every step here has a precondition that fails loudly rather than a step that assumes.

**Files:**
- Modify: `src/observe/transport.js` (the real project token)
- Modify: `package.json` (version), `package-lock.json`
- Modify: `CHANGELOG.md`
- Modify: `TROUBLESHOOTING.md`

**Interfaces:**
- Consumes: everything above.
- Produces: no code beyond the token constant.

- [ ] **Step 1: Check the starting version, do not assume it**

```bash
node -p "require('./package.json').version"
```

Expected: `0.25.0-rc.3` — slice 1 took the branch to `-rc.0`, slice 2 to `-rc.1`, slices 3 and 4 to `-rc.2` and `-rc.3`. If it is a *different* rc of `0.25.0`, that is fine; graduate from whatever it actually is. If it does **not** match `0.25.0-rc.*`, stop: either a slice did not bump, or this is not the branch you think it is.

```bash
node -e "const v=require('./package.json').version; if(!/^0\.25\.0-rc\.\d+$/.test(v)){console.error('STOP: expected 0.25.0-rc.N, found '+v);process.exit(1)}"
```

- [ ] **Step 2: Paste the real PostHog project token**

Create the project in PostHog (EU cloud), copy its **project API key** — the write-only public one that goes in a `<script>` tag, *not* a personal API key — and in `src/observe/transport.js` replace:

```js
const PROJECT_TOKEN = TOKEN_PLACEHOLDER;
```

with the literal token:

```js
const PROJECT_TOKEN = 'phc_<the real project api key>';
```

Leave `TOKEN_PLACEHOLDER` exported and unchanged: `hasToken()` compares against it, and `tests/unit/observe/transport.test.js` asserts the placeholder is rejected.

Then confirm, against PostHog's current capture documentation, that `$process_person_profile: false` is still the flag for anonymous events. If it has been renamed, drop the property and keep the constant `distinct_id` — the privacy property comes from the constant, not the flag. Do **not** switch to a per-install id.

```bash
npx jest tests/unit/observe/transport.test.js
```

- [ ] **Step 3: Bump the version**

In `package.json`, set `"version": "0.25.0"`, then:

```bash
npm install --package-lock-only
```

The CI gate `Verify version is bumped` fails any PR touching `src/`, `bin/` or `package.json` without a version not already in `git tag`; `0.25.0` has not been tagged (only the `-rc.N` prereleases have — `auto-tag.yml` has no prerelease guard, so those tags exist).

- [ ] **Step 4: Resolve the changelog ambiguity BEFORE editing — this is a hard stop**

`CHANGELOG.md` currently contains **two** `## [Unreleased]` headings:

- **line ~10** — the live one. It sits directly under the Keep-a-Changelog preamble and directly above `## [0.24.0]`, and holds slices 1–4's `### ✨ Added` entries. **This is the one that graduates.**
- **line ~123** — a stale block sitting above `## [0.23.0]`, holding four `### 🐛 Fixed` entries (#151, #148, #149, #150) that were released in 0.23.x and never collapsed.

That second heading is tracked as **issue #181 and is not yours to fix.** But "collapse `[Unreleased]`" is ambiguous while two exist, and an automated or hurried edit that collapses the wrong one silently rewrites four shipped releases' history.

Run this guard first. It must print nothing and exit 0:

```bash
n=$(grep -c '^## \[Unreleased\]$' CHANGELOG.md)
if [ "$n" != "1" ]; then
  echo "STOP: CHANGELOG.md has $n '## [Unreleased]' headings (expected 1)."
  echo "Graduation is ambiguous until #181 collapses the stale mid-file block."
  echo "Do not guess. Resolve #181 first, or graduate by explicit line number after confirming with a human."
  grep -n '^## \[Unreleased\]$' CHANGELOG.md
  exit 1
fi
```

**If it fails:** #181 has not landed. Do not proceed by picking a heading. Either land #181 first (it is a separate, already-filed piece of work) or stop and escalate. If a human explicitly directs you to proceed anyway, the heading that graduates is the **first** occurrence — the one whose next `## [` heading is `## [0.24.0]` — and you must verify that relationship by line number before touching the file, not by reading the entry text.

- [ ] **Step 5: Collapse `[Unreleased]` into the release section**

With exactly one heading present, rename it and add the slice-5 entries. The result is:

```markdown
## [0.25.0]

### ✨ Added

<the existing slice 1-4 entries, unchanged>

- **Opt-in anonymous usage telemetry, off by default.** `mauto telemetry
  enable` turns it on; `mauto telemetry status` prints the exact field list —
  rendered from the event catalog at runtime, so the disclosure cannot drift
  from what the uploader sends — alongside the endpoint and what is queued
  locally. `MAUTO_TELEMETRY=0` and `DO_NOT_TRACK=1` force it off and always win
  over config. `MAUTO_TELEMETRY=1` deliberately does *not* enable it: an
  off-switch is safe to honour from the environment, an on-switch is a way to
  turn collection on for a machine whose owner never consented.
- **Verbs never touch the network.** Every verb ends in `process.exit()`, which
  tears down a pending socket, so a fire-and-forget POST is dropped a large
  fraction of the time and an awaited one adds a round trip to every `mauto
  tap`. Instead a verb appends one line to
  `mobile-automator/.logs/telemetry.spool` — and that line *is* the upload
  payload, redacted at spool time, so a device serial is never written to the
  file that gets sent — and the session daemon uploads it during its idle
  window. `mauto telemetry flush` is the explicit escape hatch for a machine
  with no daemon. An undelivered spool is just a file the next run picks up.
- Delivery is at-least-once and bounded in every direction: each POST is capped
  at 5s, retryable failures back off from 1 minute to 30, 4xx (except 429) is
  permanent so a revoked token cannot wedge the queue, the spool is capped at
  256 KiB, and at most three pending batches are kept. A permanently-offline
  machine converges instead of growing.
- Transport is PostHog's plain HTTP capture API on EU cloud with a write-only
  public project token — **no SDK**, no new dependency. An SDK would cost
  cold-start time on every one of the dozens of process spawns a scenario makes
  and add supply-chain surface to a project already carrying high-severity
  advisories (#161). `src/observe/transport.js` is the only file in `src/` or
  `bin/` allowed to make an outbound HTTP call, enforced by
  `tests/lint/telemetry-transport-isolation.test.js`.
- No per-machine identifier exists anywhere in the system. Events carry a
  constant `distinct_id` and a per-event random `msg_id` used only to
  deduplicate a re-sent batch. `mauto setup` writes `telemetry.enabled: false`
  into `config.json` as a literal, visible key rather than relying on an absent
  one, and surfaces the notice in its envelope — a notice, never a prompt,
  because `mauto` verbs are invoked by an agent and there is nobody at the
  keyboard to consent on the human's behalf.
- New docs page: **Telemetry & Privacy** (`docs/reference/telemetry.md`),
  checked against the field catalog in both directions by
  `tests/lint/telemetry-docs.test.js`.

### 🔧 Changed

- The observability feature is graduated. <Branch A: "Slices 1–4 shipped
  ungated — the `MAUTO_OBSERVE` gate clause applied vacuously to slices that
  added no user-visible verb — and `tests/lint/no-observe-gate.test.js` now
  makes that build-enforced." / Branch B: "The `MAUTO_OBSERVE` gate is removed
  and everything it hid is unconditional; a lint guard keeps it gone.">
```

Pick the correct `### 🔧 Changed` sentence from what Task 11 actually found. Do not write both.

- [ ] **Step 6: Document the spool in TROUBLESHOOTING.md**

Add beside slice 2's `.logs/` section:

````markdown
### ❔ "Is mauto sending anything anywhere?"

Not unless you turned it on.

```bash
mauto telemetry status                          # on/off, endpoint, exact field list
cat mobile-automator/.logs/telemetry.spool      # every payload waiting to be sent
```

The spool is deliberately not named `*.ndjson`, so it stays out of the
`cat mobile-automator/.logs/*.ndjson` merged-timeline recipe above — it is a
queue that gets renamed mid-flush, not part of the event log.

If it is growing and never draining, the daemon is not running (it is what
uploads) or the network is unreachable. `mauto telemetry flush` drains it
synchronously and reports what happened. `mauto telemetry disable` stops it
being written at all.
````

- [ ] **Step 7: Run the full verification set and SHOW the output**

```bash
npm test
npm run lint:guides
npm run lint:schema-additive
./scripts/pack-smoke.sh
```

Expected: all green. Do not claim completion without pasting this output — the project's workflow requires evidence before any success claim.

One extra check worth running by hand, because it is the claim this slice would be most embarrassing to get wrong:

```bash
# In a scratch workspace with telemetry NOT enabled, no spool must ever appear.
d=$(mktemp -d) && (cd "$d" && mauto setup --mode aware >/dev/null && mauto validate nope.json >/dev/null 2>&1; ls mobile-automator/.logs/ 2>/dev/null)
```

Expected: `mauto.ndjson` and nothing named `telemetry.spool`.

- [ ] **Step 8: Commit and open the PR**

```bash
git add src/observe/transport.js package.json package-lock.json CHANGELOG.md TROUBLESHOOTING.md
git commit -m "chore(release): graduate observability to 0.25.0"
git push -u origin sh3lan93/observability-slice-2
```

```bash
gh pr create --draft \
  --title "feat(observe): opt-in telemetry, consent surface, and 0.25.0 graduation" \
  --body "$(cat <<'BODY'
## What

Slice 5 of the observability design, and the graduation of the whole 0.25.0
feature.

- Opt-in anonymous usage telemetry, off by default, with `mauto telemetry
  status | enable | disable | flush`.
- Verbs never touch the network. They append the finished upload payload to
  `mobile-automator/.logs/telemetry.spool`; the session daemon uploads it during
  its idle window on a self-rescheduling unref'd timer.
- PostHog plain HTTP capture API, EU cloud, write-only public project token, no
  SDK, no new dependency.
- `MAUTO_OBSERVE` gate removed / guarded shut, `0.25.0-rc.N` → `0.25.0`,
  `[Unreleased]` collapsed.

## Why

A one-shot process cannot reliably do network I/O. Every verb ends in
`process.exit()`, which tears down a pending socket — a fire-and-forget POST is
dropped a large fraction of the time, and the loss is *biased* toward fast
machines and warm connections, so the metric would be worse than useless.
Awaiting the POST instead adds a full round trip to every `mauto tap`, dozens of
times per scenario, for a maintainer-facing metric the user gets nothing from.

So the split is structural: verbs write a local file (synchronous, cheap, always
succeeds), and the one process here with an event loop and a genuine idle window
does the network. An undelivered spool is not an error state; it is a file the
next run picks up.

## Design notes

- **The spooled line IS the network payload.** `telemetryPayload()` runs at
  spool time, not flush time, so a device serial is never written to the file
  that gets uploaded and the queue is auditable with `cat`.
- **Delivery is at-least-once, deliberately.** Claim-then-delete via an atomic
  rename; `msg_id` (a zero-arity CSPRNG per-event token) rides along as the
  PostHog `uuid` so a re-sent batch deduplicates at ingestion. The alternative —
  rewriting the claimed file with the unsent remainder — is a write on the
  failure path whose failure mode is *losing* records rather than duplicating
  them.
- **The token ships in the package.** A PostHog project API key is write-only
  and public by design. Fetching it would mean a network round trip before the
  network round trip, a server we must keep alive forever, and no actual
  protection.
- **No per-machine identifier.** Constant `distinct_id`, no person profile, no
  install id. Aggregate verb counts and error rates still work.
- **Consent is a notice, never a prompt.** `mauto` verbs are invoked by an
  agent; there is nobody at the keyboard to answer, and an agent consenting on a
  human's behalf is worse than not asking. `mauto setup` writes a visible
  `telemetry.enabled: false` and surfaces the notice in its envelope.
- **`MAUTO_TELEMETRY=1` does not enable.** Off-switches may live in the
  environment; on-switches may not.

## Test plan

<paste the real output of npm test / lint:guides / lint:schema-additive /
pack-smoke.sh — do not invent the numbers>

Three independent layers prove no upload path is reachable while disabled:
the spool sink is never *constructed*; `flush()` returns before touching the
transport (asserted with an injected transport that throws if called); and
`tests/lint/telemetry-transport-isolation.test.js` fails the build if any file
other than `src/observe/transport.js` makes an outbound HTTP call.

Refs #168
BODY
)"
```

Note the PR body carries `Refs #168` (the production-readiness gate) and no
`Closes` line — the observability work has no single issue of its own, and
`Closes` on a gate issue would close it prematurely.

---

## Self-review

Run before handing this plan to an implementer; findings are fixed inline above rather than appended.

**Spec coverage.** Every slice-5 bullet in `docs/plans/2026-08-31-observability-design.md` is covered: opt-in PostHog spool (Tasks 4, 6), daemon flush (Task 7), consent UX (Tasks 3, 8, 9), privacy documentation (Task 10), gate removal + graduation (Tasks 11, 12). Both of the design's stated open questions are answered explicitly — the token ships (analysis §5, Task 12 Step 2) and the consent wording is a single constant with a test that it contains no question mark (Task 3).

**Placeholder scan.** No "add appropriate error handling", no "similar to Task N", no "TODO", no elided function bodies. Two intentional fill-ins are both flagged as such with a named verification step: the PostHog project token (Task 12 Step 2) and the `$process_person_profile` flag name (Task 2 Step 3 note + Task 12 Step 2).

**Type consistency.** `postBatch` returns `{ok, retry, status}` everywhere it is produced and consumed. `flush()` returns `{skipped?, sent, dropped, kept, ok, nextDelayMs}`; the daemon reads only `nextDelayMs`, the CLI reads only the counts, and both tolerate a missing field. `decideForProject` and `resolveTelemetry` return the same `{enabled, reason}` shape. `spool.stats()` returns the same four keys in `stats`, `handleTelemetryStatus` and its test.

**Interface consistency against the real tree.** Verified against this worktree at `HEAD`: `defaultSinks(projectRoot, env, {logPath})` and `boundRecorder` in `src/observe/recorder.js`; `logsDir`/`MAIN_LOG_NAME`/`DAEMON_LOG_NAME` in `src/observe/paths.js`; `EVENT_FIELDS`/`NEVER_SENDS`/`telemetryPayload` in `src/observe/event.js`; `configManager.load/set/configPath` in `src/config/manager.js`; `startDaemon`'s `observe`/`safeObserve`/`armIdle`/`stop`/`inFlight` in `src/device/session-daemon.js`; `buildRecorder`/`main` in `bin/mauto-session-daemon.js`; the scaffold skeleton in `src/setup/scaffold.js` and the guard that validates it in `tests/lint/config-schema.test.js`; `coerceValue`'s fall-through to `tryJson`, which is why a boolean-declared `telemetry.enabled` accepts `mauto config set telemetry.enabled true` with no coercion change.

**Two facts that were assumed by the task brief and are not true of the tree, corrected inline:** `MAUTO_OBSERVE` exists nowhere outside the two planning documents (Task 11 handles both branches), and `package.json` is at `0.25.0-rc.1` at the time of writing, not `-rc.3` (Task 12 Step 1 checks rather than assumes, and accepts any `0.25.0-rc.N`).
