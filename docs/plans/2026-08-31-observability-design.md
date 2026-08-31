# Observability & Monitoring for `mauto`

**Date:** 2026-08-31
**Status:** Design — approved approach, not yet sliced
**Version at design time:** 0.23.9 (first npm-published release, 2026-08-30)
**Related:** #163 (daemon stderr discarded), #156 (daemon lifecycle / invisible engine death), #161 (no audit gate), gate #168

## Problem

`mauto` has no observability of any kind. Concretely, in 6,254 lines of `src/` + `bin/`:

1. **No logging.** Zero `console.*` calls. The only diagnostic channel is three
   `process.stderr.write` sites: `diagnose()` (`src/cli.js:1637`), which prints a stack
   only for `internal`-kind errors, and the daemon's crash guards.
2. **The daemon's diagnostics are discarded by construction.** `src/device/session-spawn.js:38`
   spawns with `stdio: 'ignore'`, so every `process.stderr.write` in
   `bin/mauto-session-daemon.js` — including the `uncaughtException` stack — goes to
   `/dev/null`. The one long-lived component, wrapping a child process that drives physical
   hardware, is completely opaque. (#163, and the readable half of #156.)
3. **Nothing measures time.** There is no `hrtime` and no `Date.now()` delta outside the
   daemon readiness poll and lock staleness. `duration_seconds` in every result file is
   whatever number the calling agent passed to `--duration` (`src/cli.js:649`); `--attempts`
   likewise. The two metrics that would reveal a degrading scenario or a slow device are
   self-reported by a language model with no clock.
4. **App crashes are invisible.** mobile-mcp 0.0.55 exposes `mobile_get_crash` and
   `mobile_list_crashes`; `mauto` calls neither. When the app under test dies mid-scenario
   the agent observes "element not found" and reasons about a UI change. A QA tool that
   cannot distinguish "the app crashed" from "the button moved" produces confidently wrong
   test results.

The asset already in place: **the envelope is a structured event.**
`{ok, data, error:{kind,message}, hint, schema_version}` plus `KIND_TO_CODE`
(`src/output/envelope.js`) is a typed record with a classified failure taxonomy. Every verb
already produces one. Nothing persists or aggregates it.

## Scope

Three domains, all in scope:

| | Question answered | Consumer |
|---|---|---|
| **A. Tool self-diagnostics** | Why did `mauto` break on a user's machine? | Maintainers, from a bug report |
| **B. Run/device telemetry** | How long did that tap take? Did the app crash? Is this scenario flaking? | The AI agent mid-run; QA reading results |
| **C. Usage telemetry** | Which verbs do users run? What is the field error rate? | Maintainers, post-launch |

Explicitly **out of scope:** CI/pipeline monitoring (domain D). Tracked separately.

## Approach: one recorder seam, three sinks

A single `record(event)` function, three independently switchable sinks, two instrumentation
points. Chosen over (a) extending the result schema only, and (b) two independent tracks,
because both alternatives assume the interesting failures happen inside a scenario. This
project's own bug history says otherwise: #156 and #163 are both "the daemon died and nobody
could see why" — cases with no `runId` and no result file.

```
                                       ┌──────────────┐
  cli.js  withEnvelope ───┐            │ stderr sink  │  level-gated   → A
  cli.js  emit / emitRaw ─┤            ├──────────────┤
                          ├→ record() →│  file sink   │  NDJSON        → A + B
  daemon  call dispatch ──┤            ├──────────────┤
  daemon  lifecycle ──────┘            │  spool sink  │  opt-in        → C
                                       └──────┬───────┘
                                              │ flushed by the daemon
                                              ▼
                                     PostHog /batch (EU)
```

### Modules

New `src/observe/`, matching the existing module scale (~140 lines average):

| File | Responsibility |
|---|---|
| `event.js` | Event shape, `makeEvent()`, and the **field catalog** (below). Pure. |
| `recorder.js` | `record(event)`; level filtering, sink fan-out, failure transparency. |
| `paths.js` | Log/spool paths under the workspace. Pure, side-effect-free. |
| `settings.js` | Resolves level, log dir, and telemetry opt-in from env + `config.json`. |
| `sinks/stderr.js` | Human-ish line output for interactive debugging. |
| `sinks/file.js` | NDJSON append + size-capped rotation. |
| `sinks/spool.js` | Append-only telemetry spool + batch upload (used by the daemon). |

### Event shape

One canonical record, NDJSON on disk, one JSON object per line:

```json
{
  "ts": "2026-08-31T20:45:00.123Z",
  "v": 1,
  "level": "info",
  "src": "cli",
  "event": "verb.end",
  "verb": "tap",
  "run_id": "login-smoke-0031",
  "dur_ms": 41,
  "ok": false,
  "error_kind": "device",
  "exit_code": 2,
  "mauto_version": "0.23.9",
  "node": "v22.14.0",
  "os": "darwin",
  "session_id": "8f2c1a…"
}
```

`error_kind` is reused verbatim from the envelope's existing taxonomy — the classification
work is already done and already tested.

### The redaction contract (load-bearing)

The telemetry payload is built from an **allowlist, never a denylist**. The HTTP sink
serializes only fields the catalog marks `sends: true`; anything else — present in the local
log or not — cannot leave the machine.

This is the `action-catalog` / `capability-catalog` idiom applied to privacy: one catalog
entry per field, each carrying `sends` and a stated reason, guarded by a lint test. It exists
because the sensitive values here are not incidental. Scenario IDs and app package names are
users' **unreleased product names**; device IDs are hardware identifiers. A naive
"log the verb and its args" event would ship `mauto launch com.acme.unreleased-thing` to a
third party.

Fields permanently marked `sends: false`, enforced by
`tests/lint/telemetry-redaction.test.js`:
`error.message`, `hint`, `scenario_id`, `run_id`, `app_id`, `device_id`, `device_model`,
`project_name`, any filesystem path, any element label, any typed text.

Consequence: **the telemetry path carries no free text at all** — only enumerated values,
counts, and durations. That makes redaction provable by a structural test rather than
best-effort by review.

### Instrumentation points

Two seams cover everything:

1. **`withEnvelope` (`src/cli.js:1191`) + `emit`/`emitRaw`.** A module-level `t0` at process
   start plus the envelope at exit gives verb name, duration, outcome, and error kind for
   every invocation. `emitRaw` (the `guide`/`schema`/`bootstrap` path) must be instrumented
   too — it bypasses `emit` today.
2. **The daemon's call dispatch (`src/device/session-daemon.js:428`).** Wrapping the
   `Promise.race` around `call(req.tool, req.args)` yields per-primitive latency, timeout
   counts, and mobile-mcp error rates for *every* verb through one edit. Daemon lifecycle
   events (start, connect failure, idle reap, `ELOCKED` loss, `uncaughtException`) and the
   existing `recordUndeliverable` seam (`session-daemon.js:232`) feed the same recorder.

### Fix for #163

`src/device/session-spawn.js:38` changes from `stdio: 'ignore'` to `['ignore', fd, fd]` where
`fd` is an appended-opened handle on `mobile-automator/.logs/daemon.log`. This is a one-line
behavioural fix plus fd lifecycle management, and it makes the daemon's four existing
`stderr.write` calls readable for the first time.

### Making B honest

Rather than a second mechanism, B falls out of A's file sink. When `MAUTO_RUN_ID` is set (or
`--run-id` passed), verb events are appended to
`mobile-automator/.logs/run-<runId>.ndjson`. `result finalize` then **derives** measured
values from that trace instead of trusting flags:

- `duration_seconds` — computed from the trace when `--duration` is absent; a supplied
  `--duration` that disagrees with the measured value is recorded and flagged rather than
  silently trusted.
- retry/attempt counts — counted from repeated verb events against the same target.
- step outcomes — taken from real exit kinds.

Screenshot-on-failure: on a `device`-kind failure the CLI captures a screenshot into
`mobile-automator/screenshots/` and records its path in the trace, so a failed run carries
evidence rather than a narrative.

### Crash / ANR detection

A new `mauto crash` verb (`list` / `get`), reaching the device through a new
`DeviceBridge.listCrashes()` / `getCrash()` pair — never a direct mobile-mcp call, per the
locked invariant. Additionally, the failure path performs an automatic crash check: **only**
when an action has already failed or an element lookup returned empty. Checking after every
action would add a device round-trip to `mauto tap`, which is on the hot path; checking after
a failure costs nothing in the common case and answers the exact question that is currently
unanswerable.

Obligations: an entry in `src/device/action-catalog.js` (resolution `verb`) and an entry in
`src/result/capability-catalog.js` for the crash record's home in the result schema.

### Telemetry transport (C)

**PostHog free tier, used without its SDK.** The free plan is $0 with no credit card and
covers all three domains in one account: 1M analytics events, 100K error-tracking exceptions,
and 50GB logs per month. PostHog exposes documented plain-HTTP capture endpoints
(`POST /i/v0/e` and `/batch`) authenticated by a project token, so events go out via Node's
built-in `fetch`:

- **zero new dependencies** — cold start stays at its current 112ms, which matters because
  one scenario is dozens of `mauto` process spawns;
- **no new supply-chain surface**, on a project that already carries 7 high-severity
  advisories (#161);
- **full payload control**, which the redaction contract requires;
- **EU cloud** (`eu.i.posthog.com`) as the default host, given app package names are in play;
- switching to self-hosted PostHog later is a URL change, not a migration.

**A one-shot process cannot reliably do network I/O.** Every verb ends in `process.exit()`
(`src/cli.js:1623`), which tears down pending sockets — a fire-and-forget POST would be
dropped a large fraction of the time, and awaiting it would add network latency to every tap.
So verbs never talk to the network. They append to a local spool file (synchronous, cheap,
always succeeds), and the **daemon** flushes the spool during its idle window, with
`mauto telemetry flush` as an explicit escape hatch. An undelivered spool is just a file that
gets picked up on the next run.

### Control surface

| Control | Default | Effect |
|---|---|---|
| `MAUTO_LOG_LEVEL` | `warn` (stderr), `info` (file) | `silent`/`error`/`warn`/`info`/`debug` |
| `MAUTO_LOG_DIR` | `mobile-automator/.logs` | Relocate logs |
| `MAUTO_RUN_ID` | unset | Correlates verbs into one run trace |
| `telemetry.enabled` in `config.json` | `false` | Opt-in; set via `mauto config set` |
| `MAUTO_TELEMETRY=0` | — | Kill switch; always wins over config |
| `DO_NOT_TRACK=1` | — | Honoured; disables C |

Telemetry is **off until explicitly enabled**. There is no first-run prompt that defaults to
on, and no upload path is reachable while `telemetry.enabled` is false.

### Storage hygiene

Logs live in `mobile-automator/.logs/`, NDJSON, size-capped rotation (5MB × 2). `mauto setup`
gains a generated `mobile-automator/.gitignore` covering `.logs/`, `.session/`, and
`screenshots/`.

This closes a latent gap: `tests/unit/memory/paths.test.js:24` describes `.session/` as "the
gitignored `.session` dir", but nothing actually ignores it inside a *user's* repository —
this repo's own `.gitignore` has no bearing there. Device serials and session handles are
currently committable by accident; `.logs/` would compound that.

## Locked invariants

Every invariant from PRD #69 is preserved, and one needs an explicit guard:

- **Uniform envelope — the critical one.** stdout is owned exclusively by the envelope. No
  sink may ever write to stdout; diagnostics go to stderr and files only. Guarded by an
  integration test asserting that stdout contains exactly one JSON object for every verb at
  every log level, including `debug`.
- **Device driven only through `mauto` verbs.** Crash detection goes through a `DeviceBridge`
  method behind a verb.
- **One-shot verbs only.** No verb becomes long-lived; the spool exists precisely so none has
  to.
- **Reasoning is pulled, never ambient.** Unaffected; the execute guide gains crash-verb
  documentation.
- **Backwards compatibility.** `.logs/` is an additive directory; result-schema additions are
  additive and guarded by `tests/lint/schema-additive.test.js`; `config_schema.json` already
  sets `additionalProperties: true`.
- **Platform-agnostic selectors.** Unaffected.

Windows (#165) is not made worse: no new socket or platform-specific primitive is introduced.

## Testing

**Unit** — redaction allowlist rejects every `sends: false` field; the recorder never throws
and never propagates (a full disk must not fail `mauto tap`); file-sink rotation; level
filtering; spool batching and idempotent flush; duration derivation from a trace.

**Lint guards** — new `tests/lint/telemetry-redaction.test.js` (no free-text field is ever
`sends: true`); extend `action-coverage.test.js` for the crash action; extend
`result-coverage.test.js` for the crash record and measured-duration fields; extend
`config-schema.test.js` for the telemetry keys.

**Integration** — the envelope-purity test above; `MAUTO_LOG_LEVEL=debug` writes to stderr
only; telemetry stays unreachable while disabled (asserted by injecting a transport that
fails the test if called).

## Slice ladder

Tracer-bullet slices, gate-then-graduate per the release convention. Slices 2–5 gate their
user-visible verbs behind `MAUTO_OBSERVE=1`; the slice-1 daemon stdio fix ships **ungated**,
since it is a straight bug fix for #163 that users hit today.

| Slice | Content | Version | Closes |
|---|---|---|---|
| 1 | Recorder core, event model, field catalog + redaction lint, stderr/file sinks, daemon stdio fix, workspace `.gitignore` | `0.24.0-rc.0` | #163 |
| 2 | Daemon instrumentation: call latency, timeouts, lifecycle, connect failures, undeliverable replies | `0.24.0-rc.1` | part of #156 |
| 3 | Run traces, measured `duration_seconds` and retry counts in `finalize`, screenshot-on-failure | `0.24.0-rc.2` | — |
| 4 | `mauto crash` verb, failure-path auto-check, result-schema record, both catalog entries | `0.24.0-rc.3` | — |
| 5 | Opt-in PostHog spool + daemon flush, consent UX, privacy documentation | `0.24.0` | — |

Slice 1 stands alone and is independently valuable: it closes an open `production-ready`
issue and gives every later slice its seam.

## Open questions

None blocking. Two to settle during slice 5: whether the PostHog project token ships in the
package or is fetched at flush time, and the exact wording of the opt-in consent notice.
