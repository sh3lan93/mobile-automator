# mauto Observability — Slice 4 Implementation Plan (crash visibility)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** mobile-mcp 0.0.55 exposes `mobile_get_crash` and `mobile_list_crashes`, and `mauto` calls **neither**. When the app under test dies mid-scenario the agent observes "element not found" and confidently reasons about a UI change. A QA tool that cannot distinguish *"the app crashed"* from *"the button moved"* produces confidently wrong test results. Slice 4 closes that: a `mauto crash` verb (`list` / `get`), an automatic crash check on the **failure path only**, and a crash record the result file can carry.

**Architecture:** Three layers, each with one job. (1) `DeviceBridge.listCrashes()` / `getCrash(id)` reach the device through the existing injected `call` seam — never a direct mobile-mcp call — with a `src/device/crash-model.js` normalizer in the shape of the existing `device-model.js` / `element-model.js`. (2) `src/device/failure-probe.js` is a pure, total, deadline-bounded probe that `src/cli.js`'s `connectBridge` invokes in exactly **one** inserted line, after `fn(bridge)` returns and before `close()`. (3) `ResultStore.addCrash()` writes a root-level `crashes` array supplied by a new `mauto result add-crash` verb, bound by a `src/result/capability-catalog.js` entry.

**Tech Stack:** Node.js (CommonJS), Commander, Jest. No new dependencies — this is a hard constraint, not a preference.

**Spec:** `docs/plans/2026-08-31-observability-design.md` — "Crash / ANR detection", "Locked invariants", and slice 4 in its slice ladder. Conventions continued from `docs/plans/2026-09-01-observability-slice-2-plan.md`.

---

## Global Constraints

- **`crash` must NOT get a `src/device/action-catalog.js` entry.** That catalog holds exactly the 23 *scenario-schema* actions, and `tests/lint/action-coverage.test.js:49` asserts bidirectional parity — `expect(missingFromSchema).toEqual([])`, "catalog entry the schema never declares". A catalog entry with no matching scenario-schema action **fails the build**, and adding one to `scenario_schema.json`'s `step.action` / `preconditions.device_actions` enums would be an unplanned schema bump. `crash` is a *diagnostic* verb like `devices`, `session` and `memory` — none of which appear in that catalog. Its only catalog obligation is a `src/result/capability-catalog.js` entry for the crash record.
- **Deliberate non-goal: no `no_crash` assertion type.** That is a scenario-schema change with its own additivity implications and is not required to answer "did the app die?". Nothing in this slice touches `src/schemas/scenario_schema.json`.
- **The device is driven only through `mauto` verbs.** Crash detection reaches the device via `DeviceBridge` methods behind a verb. No file in this slice imports mobile-mcp, and no code path calls a `mobile_*` tool outside `src/device/bridge.js`.
- **The tool allowlist is bidirectional.** `src/device/mobile-mcp-tools.js` is pinned against `bridge.js` *source* by `tests/lint/mobile-mcp-tool-coverage.test.js` in both directions: a bridge call missing from the set fails, **and** a set entry the bridge never calls fails. So the two new primitives and the two new bridge methods must land in the **same commit**. Task 2 does exactly that; splitting it red-trees the build.
- **The auto-check runs ONLY on the failure path** — after an action has already failed, or after `mauto elements` returned an empty list. **Never after a successful action.** A round trip on every `mauto tap` would put a device call on the hot path; checking after a failure costs nothing in the common case.
- **The recorder must never throw and never propagate.** `record()` already guarantees this. The probe inherits the same obligation *for the envelope*: a probe failure must never mask, replace, downgrade or upgrade the original error. See "The absent-versus-empty problem" below.
- **Fields are allowlisted, never denylisted.** Any new field must get an `EVENT_FIELDS` entry in `src/observe/event.js` with a `sends` flag and a `why`, or `makeEvent` silently drops it and `tests/lint/telemetry-redaction.test.js` fails the build. A `sends: true` field must be a **structurally closed vocabulary, never a raw string** — this shipped as a bug three times (`verb` carried `process.argv[2]`; `tool` needed a pinned allowlist; `session_id` needed a zero-arity CSPRNG generator).
- **stdout belongs exclusively to the verb's own output.** No sink, no probe, no diagnostic may write to stdout. `crash get` returns its report **inside the envelope** — it does not join `guide`/`schema`/`bootstrap` on the raw path. Adding a fourth raw verb would widen the one exception the stdout-purity guard has to carve out.
- **No new dependencies.** Cold start is ~112ms and one scenario is dozens of process spawns.
- **Bind, do not copy.** Three places in this slice reuse an existing binding instead of minting a new one, and each is called out where it happens: the crash watermark reuses `session.json`'s existing `started_at`; the crashed process name reuses the `app_id` event field; the crash excerpt reuses the `message` event field.
- **Slice 3 is assumed, not built.** `tests/lint/result-schema-additive.test.js` and `tests/fixtures/result_schema_v2.0.json` are slice 3's deliverable. Do **not** create them here, do not duplicate them. Task 5 depends only on the *guarantee* they encode (the result schema is additive over v2.0), never on their internals. Slice 3 also edits `connectBridge` for screenshot-on-failure; Task 4's change to that function is deliberately **one inserted line** so the two compose without a merge argument.
- **CI version gate:** this touches `src/`, so `package.json` `version` must be bumped to a value not yet in `git tag`. `main` is at 0.24.0; slice 1 took the branch to `0.25.0-rc.0`, slice 2 to `0.25.0-rc.1`, slice 3 to `0.25.0-rc.2`. Slice 4's target is **`0.25.0-rc.3`**.
- **Platform-agnostic:** never emit `resource-id` or OS-specific element IDs in any artifact.

---

## The absent-versus-empty problem

This slice has one cross-cutting design problem, and every awkward decision below follows from it. The reasoning is stated once, here, rather than re-derived in six task comments.

**The failure mode this slice exists to prevent is a confident wrong answer.** So the thing to be most careful about is *manufacturing a second one*. There are three states, not two, and code that collapses them is worse than code that never looked:

| State | Meaning | What the agent should conclude |
|---|---|---|
| `crashes: [ … ]` | We asked the device and it reported crash reports. | The app died. Stop reasoning about the UI. |
| `crashes: []` | We asked the device and it reported none. | The app is alive; the failure is a real UI failure. |
| *(no `crashes` key at all)* | We could not ask, or the answer was not attributable. | Unknown. Reason as before, with no new claim either way. |

`crashes: []` is a **positive claim of health**. Emitting it when the probe timed out, when `mobilecli` was unavailable, or when the device rejected the call would be exactly the bug this slice is fixing, with the sign flipped — the tool would confidently tell the agent the app is fine when it has no idea. Hence the rule that shapes the whole probe:

> **The probe attaches a key or attaches nothing. It never attaches an empty array it did not earn.**

Four consequences, each of which is a task decision below.

**1. The probe's own failures are swallowed into the log, not into the envelope.** A probe error is recorded as `crash.probe_failed` at `warn` (it lands in `.logs/mauto.ndjson`, and on stderr only if the user raised the level) and returns `null`. The original error goes back to the caller byte-identical. Turning "tap failed: element not found" into "tap failed AND crash probing is broken" buries the error the caller actually needs. This is the same discipline `record()` already has, applied one layer out.

**2. The probe needs its own deadline, shorter than the daemon's.** A device call through the session daemon is bounded by `DAEMON_CALL_TIMEOUT_MS` (25s). A hung crash probe would therefore add up to 25 seconds to a verb that has *already failed* — the caller is waiting on a known-bad outcome for a courtesy lookup. `CRASH_PROBE_TIMEOUT_MS = 3000` is the probe's own budget; on expiry it records `crash.probe_timeout` at `warn` and returns `null`. 3s is generous for a `mobilecli device crashes list` against a connected device and short enough to be invisible next to the failure the user is already reading.

**3. The `crash` *verb* does the opposite of the probe, and must.** `mauto crash list` was invoked deliberately by an agent asking a question. When the device cannot answer, it returns `fail('device', …)` — exit 2 — never `ok: true, crashes: []`. Verb and probe differ here on purpose: the verb's caller asked and deserves the truth including "I could not look"; the probe's caller asked about something else entirely and must not have their error rewritten. The same underlying failure produces a loud envelope in one path and a quiet log line in the other, and that is correct.

**4. Attribution — a crash report is not automatically *this* crash.** This is where the platform asymmetry bites (see "Per-platform behaviour" below). An iOS `DiagnosticReports` file from last Tuesday sits on the device forever and will be returned by `list` today. Reporting it as evidence that *this step* killed the app is another confident wrong answer. So the probe is **time-scoped**: it filters to reports at or after a watermark, and it reports which watermark it used.

The watermark is `started_at` from `mobile-automator/.session/session.json` — a field that has been in the handle since before this work started (`src/device/session-daemon.js:610`) and is written at exactly the right moment (once the daemon is listening) and removed at exactly the right moment (`stop()`). **Bind, do not copy:** there is no new artifact, no new timestamp file, and no second source of truth about when this device session began. When no daemon handle exists the watermark is `null`, which means *unscoped*, and the probe then attaches nothing rather than attaching unattributable reports — state 3, not state 1.

A report whose own timestamp is missing or unparseable is neither included nor silently dropped: it is counted in `unattributed` so the agent can see that the device returned something the tool could not place in time.

### What deliberately does not change

`src/observe/recorder.js`, `src/observe/settings.js`, `src/observe/paths.js`, both sinks, `src/util/log-rotate.js`, `src/device/session-daemon.js`, `src/device/device-call.js` and `src/device/action-catalog.js` are **untouched**. `src/observe/event.js` gains exactly one field. `src/cli.js`'s `connectBridge` gains exactly one line.

---

## Per-platform behaviour (`mobile_list_crashes` / `mobile_get_crash`), verified

Do not assume symmetry, and do not assume the primitives are always reachable. What was verified in `node_modules/@mobilenext/mobile-mcp@0.0.55`:

- **Both tools take a `device` argument** (`lib/server.js:544`, `:551`), like every other mobile-mcp tool except discovery. `mauto` does **not** pass it: `src/device/tool-args.js` injects the resolved device id into every call except `mobile_list_available_devices`. So the new bridge methods take no device parameter, exactly like `listElements()` and `tap()`.
- **Return shapes differ from each other.** `mobile_list_crashes` returns `JSON.stringify(response.data)` — a JSON **array** of report descriptors. `mobile_get_crash` returns `response.data.content` — a **bare string**, the crash log text. `parseToolResult` (`src/device/mobile-mcp-client.js`) prefers JSON and falls back to raw text, so both arrive at the bridge correctly without any special casing. The bridge must not assume the `list` payload is already an array: parse defensively, in the idiom `normalizeDevices` already established for `mobile_list_available_devices`.
- **Availability is not a platform question.** Both tools delegate to `mobilecli`, a Go binary, and that binary implements `ListCrashReports` / `GetCrashReport` for **all four** device kinds — `AndroidDevice` (via its `getCrashLog`), `IOSDevice`, `SimulatorDevice` and `RemoteDevice`. There is no platform on which `mauto` should hard-code "unsupported", and this slice contains **no platform branch**.
- **Availability *is* an installation question.** Both tool handlers call `ensureMobilecliAvailable()` first (`lib/server.js:124`), which raises mobile-mcp's `ActionableError` when the binary is missing or its `--version` check fails. `mobilecli` reaches `mauto` **transitively** (through `mobilewright`), not as a direct pin in our `package.json`, and it ships no `windows-arm64` build. So "the primitive is unavailable" is a genuinely reachable state on a correctly-installed `mauto`, not a hypothetical. mobile-mcp surfaces `ActionableError` as text carrying `MOBILE_MCP_ACTIONABLE_SUFFIX`, which `parseToolResult` already converts into a thrown `Error` — so it arrives at the bridge as an ordinary rejection and needs no new detection code.
- **The asymmetry that actually matters is retention, not availability.** Android crash reports are read out of the device's log/dropbox and **age out** — a crash from an hour ago may already be gone. iOS device and simulator reports are **files under `DiagnosticReports`** that persist until someone clears them and therefore **accumulate across runs**. The same `mauto crash list` call is under-inclusive on Android and over-inclusive on iOS.

  This is the sole reason the auto-check is time-scoped rather than "is there any crash report on this device". On Android, `since` costs nothing (the buffer is already recent). On iOS, `since` is the difference between "your app crashed just now" and "your app crashed sometime in the last month", which are not the same claim.

**What the verb does when the primitive is unsupported or unavailable:** `mauto crash list` and `mauto crash get` return `fail('device', <the engine's message>, <hint>)` → exit 2. Never `ok: true` with an empty list. The hint names the actual remedy: `"The device engine could not read crash reports. Run \`mauto devices\` to confirm the device is reachable; crash reporting requires the mobilecli helper that ships with the device engine."` — no `mobile_*` tool name appears in it (that would leak the engine's vocabulary into a user-facing string; `tests/lint/guide-no-mcp-tool-leak.test.js` polices the guides and the same discipline applies here by hand).

---

## How the verb is gated

The design's slice ladder says slices 2–5 gate their **user-visible verbs** behind `MAUTO_OBSERVE=1`. That clause was vacuous for slice 2, which added no verb. It is **not** vacuous here. Two surfaces, two different answers, and both are deliberate:

**Gated — the `crash` verb and the failure-path auto-check.** `program.command('crash')` is registered only when `observeEnabled(env)` is true, so with the gate unset `mauto crash list` is an unknown command and lands as the usual `invalid_input` envelope through commander's existing error routing (#146). Not a stub, not a "feature disabled" envelope — *absent*, which is what the gate is for. The probe is behind the same check in the same helper: with the gate unset `connectBridge` behaves byte-identically to slice 3, so an ungated user sees no new device round trips and no new envelope keys.

One env var, one predicate, one place: `src/observe/gate.js` exporting `observeEnabled(env = process.env)`. Slice 5 reuses it for the telemetry surface and the graduation PR deletes both call sites together.

**Not gated — `mauto result add-crash` and the result-schema `crashes` field.** Two reasons, the second checkable:

1. The gate exists to hide a *half-built device capability*. `result add-crash` is a complete, self-contained result-file writer with no device dependency; an agent that never calls it sees a result file byte-identical to today's, because `crashes` is written only when non-empty (Task 5). There is no partial state to hide.
2. `tests/lint/result-coverage.test.js:39` calls `buildProgram()` in a plain environment and asserts that every `RESULT_CAPABILITIES` entry's verb is registered. Gating `result add-crash` would make that guard fail whenever `MAUTO_OBSERVE` is unset — i.e. in CI. A gate that red-trees a structural guard is the wrong gate.

**Not in the bootstrap verb map.** `emitBootstrap()` (`src/guide/emitter.js:96`) is a hand-written list that already omits every diagnostic verb — `devices`, `session`, `memory`, `init`, `mcp`. `crash` is a diagnostic verb and belongs with them: the map is the agent's always-loaded floor, and a gated verb in it would advertise something that may not exist. Crash handling is taught by `mauto guide execute`, which is pulled on demand (Task 6).

**No effect on `tests/lint/docs-counts.test.js`.** It derives its counts from `scenario_schema.json`'s enums and `ACTION_CATALOG`. Slice 4 touches neither, so no prose count changes.

---

### Task 1: Vocabulary — the one new event field

Written first because every later task records events, and a field with no catalog entry is silently dropped by `makeEvent` rather than failing loudly at the call site.

`crash_count` is the only new field, and that is the point. Everything else these events carry already has a correctly-classified home:

- the crashed **process name** reuses `app_id` (`sends: false`, "*an unreleased product's package name*") — a crashed process name is that exact string;
- the crash **excerpt / engine error text** reuses `message` (`sends: false`, "*free text; may embed labels, paths, typed input*");
- the report **file path** reuses `path` (`sends: false`).

Minting `crash_process` and `crash_excerpt` would be copying a mechanism to change a binding. Reusing the existing entries is what the catalog is *for*, and it means slice 4 adds exactly one new redaction decision to review instead of four.

`crash_count` is `sends: true`. It is an integer count with no user content, and it answers the single aggregate question worth asking — *how often does the app under test die during `mauto` runs?* — with zero bytes of user data. Per the closed-vocabulary rule it is **coerced at every record site**, never passed through: a non-finite value records no field rather than a surprise.

**Files:**
- Modify: `src/observe/event.js` (the `EVENT_FIELDS` catalog)
- Test: `tests/unit/observe/event.test.js` (extend)

**Interfaces:**
- Consumes: nothing.
- Produces: `EVENT_FIELDS.crash_count` — `{ sends: true, why: … }`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/observe/event.test.js`:

```js
describe('crash field classifications', () => {
  const { EVENT_FIELDS, NEVER_SENDS, makeEvent, telemetryPayload } = require('../../../src/observe/event');

  it('lets a crash event carry a count', () => {
    expect(EVENT_FIELDS.crash_count).toBeDefined();
    expect(EVENT_FIELDS.crash_count.sends).toBe(true);
    expect(typeof EVENT_FIELDS.crash_count.why).toBe('string');
    expect(EVENT_FIELDS.crash_count.why.trim().length).toBeGreaterThan(0);
  });

  it('mints NO new field for the crashed process or the stack — those reuse app_id and message', () => {
    // Slice 4 deliberately adds one field, not four. A crashed process name IS
    // an app id and a stack excerpt IS free text; both already have a correct
    // sends:false classification, and a near-copy would be a second decision to
    // keep in sync with the first.
    expect(EVENT_FIELDS.crash_process).toBeUndefined();
    expect(EVENT_FIELDS.crash_excerpt).toBeUndefined();
    expect(EVENT_FIELDS.app_id.sends).toBe(false);
    expect(EVENT_FIELDS.message.sends).toBe(false);
    expect(NEVER_SENDS).toContain('app_id');
    expect(NEVER_SENDS).toContain('message');
  });

  it('round-trips a crash event, sending the count and nothing else about it', () => {
    const e = makeEvent({
      src: 'cli',
      event: 'crash.detected',
      verb: 'tap',
      crash_count: 2,
      app_id: 'com.acme.unreleased-thing',
      message: 'FATAL EXCEPTION: main\n\tat com.acme.Login.onClick(Login.java:42)',
      path: '/Users/someone/proj/mobile-automator/results/crash-1.txt',
    });
    expect(e.crash_count).toBe(2);
    expect(e.app_id).toBe('com.acme.unreleased-thing');

    const p = telemetryPayload(e);
    expect(p.crash_count).toBe(2);
    expect(p).not.toHaveProperty('app_id');
    expect(p).not.toHaveProperty('message');
    expect(p).not.toHaveProperty('path');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest tests/unit/observe/event.test.js
```

Expected: the first and third tests fail (`EVENT_FIELDS.crash_count` is `undefined`). The second passes already — it pins a decision, so it must be green before *and* after, and would only ever go red if someone later adds the fields it forbids.

- [ ] **Step 3: Write the implementation**

In `src/observe/event.js`, add to `EVENT_FIELDS` immediately after the `--- daemon ---` block, under a new heading:

```js
  // --- crash (slice 4) ---------------------------------------------------
  // The ONLY new field slice 4 mints. As with `verb`, `tool` and `session_id`,
  // the sends:true justification is only true if the value is enforced to be
  // one: every record site coerces with Number.isFinite before recording, so a
  // malformed engine payload records no field rather than an arbitrary value.
  //
  // Deliberately no crash_process / crash_excerpt / crash_path fields: a
  // crashed process name IS an app id, a stack excerpt IS free text and a
  // report location IS a filesystem path. Those three entries already carry the
  // right classification, and a near-copy would be a second decision to keep in
  // sync with the first.
  crash_count: { sends: true, why: 'integer count of crash reports observed; carries no user content' },
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest tests/unit/observe/event.test.js tests/lint/telemetry-redaction.test.js
```

Expected: all green. The redaction guard must be run here too — it iterates the catalog, so a new entry is in its jurisdiction immediately.

- [ ] **Step 5: Commit**

```bash
git add src/observe/event.js tests/unit/observe/event.test.js
git commit -m "feat(observe): classify crash_count in the event field catalog

Crash events reuse app_id (process name), message (stack excerpt) and path
(report location) rather than minting near-copies, so slice 4 adds exactly one
new redaction decision. crash_count is sends:true because it is an integer with
no user content, and every record site coerces it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KmSR7wKHGdpze7SVzuqg26"
```

---

### Task 2: The bridge primitives, the tool allowlist, and the crash model

These three land together because `tests/lint/mobile-mcp-tool-coverage.test.js` is **bidirectional**: a bridge call missing from `MOBILE_MCP_TOOLS` fails one assertion and an allowlist entry the bridge never calls fails the other. Splitting this task red-trees the build in either order.

The normalizer is its own module for the same reason `device-model.js` and `element-model.js` are: the engine's payload shape is not `mauto`'s contract. `mobilecli` is a separately-versioned Go binary reached transitively, and its `CrashReport` struct is not something this repo can pin. So the model tolerates a bare array, a `{crashes:[…]}` envelope and a JSON string, and reads each descriptor's fields through a list of plausible key spellings — the same defensive posture `getScreenSize()` already takes against a human-readable string. The one thing it never does is invent a field: an unreadable id yields `null`, not a guess.

**Files:**
- Create: `src/device/crash-model.js`
- Modify: `src/device/bridge.js`
- Modify: `src/device/mobile-mcp-tools.js`
- Test: `tests/unit/device/crash-model.test.js` (create)
- Test: `tests/unit/device/bridge.test.js` (extend)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `crash-model.normalizeCrashes(raw) => Array<{ id: string|null, process: string|null, timestamp: string|null }>`
  - `crash-model.crashTimestampMs(crash) => number|null`
  - `DeviceBridge#listCrashes() => Promise<Array<CrashDescriptor>>`
  - `DeviceBridge#getCrash(id) => Promise<string>`
  - `MOBILE_MCP_TOOLS` gains `mobile_list_crashes`, `mobile_get_crash`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/device/crash-model.test.js`:

```js
'use strict';

const { normalizeCrashes, crashTimestampMs } = require('../../../src/device/crash-model');

describe('normalizeCrashes', () => {
  it('accepts a bare array of descriptors', () => {
    expect(
      normalizeCrashes([{ id: 'r1', processName: 'com.acme.app', timestamp: '2026-09-05T10:00:00Z' }])
    ).toEqual([{ id: 'r1', process: 'com.acme.app', timestamp: '2026-09-05T10:00:00Z' }]);
  });

  it('accepts a { crashes: [...] } envelope', () => {
    expect(normalizeCrashes({ crashes: [{ id: 'r1' }] })).toEqual([
      { id: 'r1', process: null, timestamp: null },
    ]);
  });

  it('accepts a JSON string, because the engine stringifies its payload', () => {
    // mobile-mcp's mobile_list_crashes returns JSON.stringify(response.data);
    // parseToolResult usually parses it, but a text/JSON fallback can leave it
    // a string, and a normalizer that only handles the happy shape is how a
    // silently-empty list happens.
    expect(normalizeCrashes('[{"id":"r1"}]')).toEqual([
      { id: 'r1', process: null, timestamp: null },
    ]);
  });

  it('tolerates the key spellings a separately-versioned engine may use', () => {
    expect(
      normalizeCrashes([{ crashId: 'r9', bundleId: 'com.acme.app', date: '2026-09-05T10:00:00Z' }])
    ).toEqual([{ id: 'r9', process: 'com.acme.app', timestamp: '2026-09-05T10:00:00Z' }]);
  });

  it('never invents a field it could not read', () => {
    expect(normalizeCrashes([{ nothing: 'useful' }])).toEqual([
      { id: null, process: null, timestamp: null },
    ]);
  });

  it('returns an empty array for anything unreadable rather than throwing', () => {
    for (const raw of [null, undefined, 42, 'not json', {}, [null], [3]]) {
      expect(Array.isArray(normalizeCrashes(raw))).toBe(true);
    }
    expect(normalizeCrashes(null)).toEqual([]);
    expect(normalizeCrashes([null, 3])).toEqual([]);
  });
});

describe('crashTimestampMs', () => {
  it('parses an ISO timestamp', () => {
    expect(crashTimestampMs({ timestamp: '2026-09-05T10:00:00.000Z' })).toBe(
      Date.parse('2026-09-05T10:00:00.000Z')
    );
  });

  it('parses epoch seconds and epoch milliseconds', () => {
    expect(crashTimestampMs({ timestamp: 1788000000 })).toBe(1788000000 * 1000);
    expect(crashTimestampMs({ timestamp: 1788000000000 })).toBe(1788000000000);
  });

  it('returns null — never 0, never NaN — when the time is unreadable', () => {
    // 0 would compare as "before every watermark" and silently drop the report;
    // NaN would compare false against everything and silently drop it too. Both
    // are the confident-wrong-answer failure this slice exists to prevent, so
    // an unreadable time is reported as unattributed instead.
    expect(crashTimestampMs({ timestamp: null })).toBeNull();
    expect(crashTimestampMs({ timestamp: 'yesterday-ish' })).toBeNull();
    expect(crashTimestampMs({})).toBeNull();
    expect(crashTimestampMs(null)).toBeNull();
  });
});
```

Append to `tests/unit/device/bridge.test.js`:

```js
describe('crash primitives', () => {
  const { DeviceBridge } = require('../../../src/device/bridge');

  it('lists crashes through mobile_list_crashes and returns the normalized model', async () => {
    const calls = [];
    const bridge = new DeviceBridge({
      call: async (tool, args) => {
        calls.push([tool, args]);
        return [{ id: 'r1', processName: 'com.acme.app', timestamp: '2026-09-05T10:00:00Z' }];
      },
    });
    await expect(bridge.listCrashes()).resolves.toEqual([
      { id: 'r1', process: 'com.acme.app', timestamp: '2026-09-05T10:00:00Z' },
    ]);
    // No `device` argument: src/device/tool-args.js injects the resolved id into
    // every call except discovery, exactly as it does for tap/listElements.
    expect(calls).toEqual([['mobile_list_crashes', {}]]);
  });

  it('fetches one report through mobile_get_crash and returns it as text', async () => {
    const calls = [];
    const bridge = new DeviceBridge({
      call: async (tool, args) => {
        calls.push([tool, args]);
        return 'FATAL EXCEPTION: main\n\tat com.acme.Login.onClick(Login.java:42)';
      },
    });
    await expect(bridge.getCrash('r1')).resolves.toContain('FATAL EXCEPTION');
    expect(calls).toEqual([['mobile_get_crash', { id: 'r1' }]]);
  });

  it('stringifies a non-string report body rather than returning an object', async () => {
    const bridge = new DeviceBridge({ call: async () => ({ content: 'boom' }) });
    await expect(bridge.getCrash('r1')).resolves.toBe('boom');
  });

  it('propagates an engine failure rather than reporting an empty list', async () => {
    // "mobilecli is not available" must NOT launder into `ok: true, []`. See
    // "The absent-versus-empty problem".
    const bridge = new DeviceBridge({
      call: async () => {
        throw new Error('mobilecli is not available or not working properly');
      },
    });
    await expect(bridge.listCrashes()).rejects.toThrow(/mobilecli is not available/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest tests/unit/device/crash-model.test.js tests/unit/device/bridge.test.js
```

Expected: `crash-model.test.js` fails to resolve the module; the bridge tests fail with `bridge.listCrashes is not a function`.

- [ ] **Step 3: Write the implementations**

Create `src/device/crash-model.js`:

```js
'use strict';

// Agnostic crash-report model, in the shape of device-model.js / element-model.js.
//
// It exists because the engine's payload is not mauto's contract. mobile-mcp's
// mobile_list_crashes delegates to `mobilecli`, a separately-versioned Go binary
// that reaches us TRANSITIVELY (through mobilewright) rather than as a pin in our
// package.json, so its CrashReport struct is not something this repo can hold
// still. Normalizing here means a key rename upstream costs one line in one
// file instead of a silently-empty crash list at the call sites.
//
// The one thing this module never does is invent a field. An unreadable id or
// time is `null`, and callers treat null-timed reports as UNATTRIBUTED rather
// than assuming them recent or assuming them stale — see the "absent-versus-
// empty problem" section of the slice-4 plan.

// Plausible spellings for each field, most-likely first. A list rather than a
// single key because "which spelling does mobilecli use this month" is exactly
// the fact we refuse to depend on.
const ID_KEYS = ['id', 'crashId', 'crash_id', 'reportId', 'name'];
const PROCESS_KEYS = ['processName', 'process', 'packageName', 'bundleId', 'bundle_id', 'appId'];
const TIME_KEYS = ['timestamp', 'time', 'date', 'createdAt', 'created_at'];

function firstString(obj, keys) {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return null;
}

function firstValue(obj, keys) {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

// Accepts a bare array, a { crashes: [...] } envelope, or the JSON text of
// either — mobile-mcp stringifies its payload and parseToolResult's text
// fallback can hand it to us unparsed.
function toArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      return toArray(JSON.parse(raw));
    } catch (_) {
      return [];
    }
  }
  if (raw && typeof raw === 'object') {
    for (const k of ['crashes', 'reports', 'data', 'items']) {
      if (Array.isArray(raw[k])) return raw[k];
    }
  }
  return [];
}

function normalizeCrashes(raw) {
  return toArray(raw)
    .filter((c) => c && typeof c === 'object' && !Array.isArray(c))
    .map((c) => ({
      id: firstString(c, ID_KEYS),
      process: firstString(c, PROCESS_KEYS),
      timestamp: (() => {
        const t = firstValue(c, TIME_KEYS);
        return t == null ? null : String(t);
      })(),
    }));
}

// Epoch milliseconds for a normalized crash, or null when the time cannot be
// read. Never 0 and never NaN: 0 sorts before every watermark and NaN compares
// false against every watermark, so BOTH would silently drop the report. A
// dropped crash report is the confident wrong answer this slice exists to
// prevent, so unreadable is reported as unreadable.
function crashTimestampMs(crash) {
  const t = crash && crash.timestamp;
  if (t == null || t === '') return null;
  if (typeof t === 'number' && Number.isFinite(t)) {
    // Heuristic shared with every log tool: a 10-digit value is seconds.
    return t < 1e12 ? Math.round(t * 1000) : Math.round(t);
  }
  const s = String(t).trim();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    return n < 1e12 ? n * 1000 : n;
  }
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? parsed : null;
}

module.exports = { normalizeCrashes, crashTimestampMs };
```

In `src/device/bridge.js`, add the require at the top alongside the existing model imports:

```js
const { normalizeCrashes } = require('./crash-model');
```

and append these two methods to `DeviceBridge`, after `setOrientation`:

```js
  // Crash reports currently readable on the device, as the agnostic crash
  // model. DIAGNOSTIC only — never invoked by a scenario action, which is why
  // `crash` has no src/device/action-catalog.js entry (that catalog holds
  // exactly the scenario-schema actions and its lint guard asserts parity).
  //
  // No `device` argument: src/device/tool-args.js injects the resolved id into
  // every tool except discovery.
  //
  // Retention differs by platform and the caller must know it: Android reports
  // come from the device log and AGE OUT; iOS device/simulator reports are files
  // that PERSIST and accumulate across runs. Same call, under-inclusive on one
  // platform and over-inclusive on the other — hence the `since` scoping in
  // src/device/failure-probe.js. There is deliberately no platform branch here.
  async listCrashes() {
    return normalizeCrashes(await this._call('mobile_list_crashes', {}));
  }

  // The full text of one crash report. The engine returns a bare string (its
  // `response.data.content`), so coerce rather than assume: an engine that
  // starts wrapping it must not turn this into "[object Object]" at the CLI.
  async getCrash(id) {
    const result = await this._call('mobile_get_crash', { id });
    if (typeof result === 'string') return result;
    if (result && typeof result === 'object' && typeof result.content === 'string') {
      return result.content;
    }
    return String(result == null ? '' : result);
  }
```

In `src/device/mobile-mcp-tools.js`, add the two primitives to the frozen set (after `mobile_set_orientation`) and update the header comment, which currently forward-references this change:

```js
    'mobile_set_orientation',
    // Diagnostic, not a scenario action — see DeviceBridge#listCrashes.
    'mobile_list_crashes',
    'mobile_get_crash',
```

Replace the last paragraph of that file's header comment:

```js
// tests/lint/mobile-mcp-tool-coverage.test.js pins this set to the primitives
// src/device/bridge.js calls, in BOTH directions, so neither a new bridge call
// nor a stale entry can drift. The guard being bidirectional is why the crash
// primitives and DeviceBridge#listCrashes/#getCrash landed in one commit: either
// half alone fails one of its two assertions.
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest tests/unit/device/crash-model.test.js tests/unit/device/bridge.test.js tests/lint/mobile-mcp-tool-coverage.test.js tests/lint/action-coverage.test.js
```

Expected: all green. `action-coverage.test.js` is run **deliberately** — it is the guard that fails if anyone "helpfully" adds `crash` to the action catalog. Green here is the evidence that this slice stayed out of that catalog.

- [ ] **Step 5: Commit**

```bash
git add src/device/crash-model.js src/device/bridge.js src/device/mobile-mcp-tools.js \
        tests/unit/device/crash-model.test.js tests/unit/device/bridge.test.js
git commit -m "feat(device): reach mobile-mcp's crash primitives through DeviceBridge

listCrashes()/getCrash() plus the agnostic crash model and the two allowlist
entries, in one commit because the tool-coverage guard is bidirectional. No
action-catalog entry: crash is a diagnostic verb, not a scenario action.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KmSR7wKHGdpze7SVzuqg26"
```

---

### Task 3: The observe gate

One predicate, one module, two consumers in this slice (the `crash` verb registration, the failure probe) and one in slice 5. It is its own task because the alternative — an inline `process.env.MAUTO_OBSERVE === '1'` at each site — is the shape that produces a half-gated feature, and because the graduation PR needs one thing to delete.

**Files:**
- Create: `src/observe/gate.js`
- Test: `tests/unit/observe/gate.test.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `gate.observeEnabled(env = process.env) => boolean`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/observe/gate.test.js`:

```js
'use strict';

const { observeEnabled } = require('../../../src/observe/gate');

describe('observeEnabled', () => {
  it('is off by default — an unset gate means the feature is absent', () => {
    expect(observeEnabled({})).toBe(false);
  });

  it('is on for exactly "1"', () => {
    expect(observeEnabled({ MAUTO_OBSERVE: '1' })).toBe(true);
  });

  it('is off for every other value, including truthy-looking ones', () => {
    // Deliberately strict. The design names the gate `MAUTO_OBSERVE=1`, and a
    // gate that also accepts "true"/"yes"/"0"-with-whitespace is a gate whose
    // real vocabulary nobody can state. One value, documented, testable.
    for (const v of ['', '0', 'true', 'yes', 'on', ' 1', '1 ', 'MAUTO_OBSERVE']) {
      expect(observeEnabled({ MAUTO_OBSERVE: v })).toBe(false);
    }
  });

  it('never throws on a hostile or absent env', () => {
    expect(observeEnabled(null)).toBe(false);
    expect(observeEnabled(undefined ? undefined : {})).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest tests/unit/observe/gate.test.js
```

Expected: the module does not resolve.

- [ ] **Step 3: Write the implementation**

Create `src/observe/gate.js`:

```js
'use strict';

// The gate-then-graduate switch for slice 4's and slice 5's user-visible
// surfaces, per the observability design's slice ladder.
//
// One predicate in one module rather than an inline env read at each site: a
// half-gated feature (the verb hidden, the behaviour change not) is the exact
// partial state the gate exists to prevent, and the graduation PR needs one
// thing to delete rather than a grep.
//
// Deliberately strict — the value is '1', not "anything truthy". A gate whose
// accepted vocabulary nobody can state is a gate nobody can reason about, and
// this one appears in a CHANGELOG entry users will copy.
//
// NOT applied to `mauto result add-crash` or to the result schema's `crashes`
// field: both are complete, device-free and inert when unused, and gating the
// verb would fail tests/lint/result-coverage.test.js, which builds the program
// in a plain environment.
function observeEnabled(env) {
  return Boolean(env) && env.MAUTO_OBSERVE === '1';
}

module.exports = { observeEnabled };
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest tests/unit/observe/gate.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/observe/gate.js tests/unit/observe/gate.test.js
git commit -m "feat(observe): add the MAUTO_OBSERVE gate predicate

One predicate, one module, one thing for the graduation PR to delete.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KmSR7wKHGdpze7SVzuqg26"
```

---

### Task 4: The `mauto crash list` / `mauto crash get` verb

The diagnostic verb. It answers a question the agent asked deliberately, so — unlike the probe in Task 5 — it fails loudly when it cannot look.

Two decisions worth stating at the call site:

**`crash get` stays on the envelope path.** `guide`, `schema` and `bootstrap` print raw content because an agent injects that text into its own context wholesale. A crash report is *data about a run*, and the stdout-purity guard already has to carve out three raw verbs by name; a fourth widens the one exception the locked "uniform envelope" invariant has.

**`crash get` bounds its output by default.** A native Android tombstone is tens of kilobytes. Emitting it whole into an envelope puts it straight into the agent's context window. So the default is the **head** — the exception type and the top frames, which is the diagnostic part — with `--full` to opt out and `--out <path>` to write the whole report to a file and return only its path. `--out` is how a 100 KB report reaches a result file (Task 6's `report_path`) without passing through anyone's context.

**Files:**
- Modify: `src/cli.js` (handlers + registration)
- Test: `tests/unit/cli/crash-verb.test.js` (create)
- Test: `tests/integration/cli-smoke.test.js` (extend — confirm the verb's absence when ungated)

**Interfaces:**
- Consumes: `DeviceBridge#listCrashes` / `#getCrash` (Task 2), `observeEnabled` (Task 3), `crashTimestampMs` (Task 2).
- Produces:
  - `handleCrashList({ deviceBridge, projectRoot }, opts) => { envelope, exitKind }`
  - `handleCrashGet({ deviceBridge, fs }, id, opts) => { envelope, exitKind }`
  - registered commands `crash list` / `crash get <id>`, gated.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/cli/crash-verb.test.js`:

```js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { handleCrashList, handleCrashGet, buildProgram } = require('../../../src/cli');

const CRASHES = [
  { id: 'r-old', process: 'com.acme.app', timestamp: '2026-09-01T09:00:00.000Z' },
  { id: 'r-new', process: 'com.acme.app', timestamp: '2026-09-05T10:30:00.000Z' },
  { id: 'r-undated', process: 'com.acme.app', timestamp: null },
];

const bridgeReturning = (crashes) => ({ listCrashes: async () => crashes });

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-crash-verb-'));
}

describe('handleCrashList', () => {
  it('reports every crash when no watermark applies', async () => {
    const r = await handleCrashList({ deviceBridge: bridgeReturning(CRASHES), projectRoot: tmpRoot() });
    expect(r.exitKind).toBe('ok');
    expect(r.envelope.ok).toBe(true);
    expect(r.envelope.data.count).toBe(3);
    expect(r.envelope.data.since).toBeNull();
    expect(r.envelope.data.crashes.map((c) => c.id)).toEqual(['r-old', 'r-new', 'r-undated']);
  });

  it('scopes to --since and reports undated reports separately rather than dropping them', async () => {
    const r = await handleCrashList(
      { deviceBridge: bridgeReturning(CRASHES), projectRoot: tmpRoot() },
      { since: '2026-09-05T00:00:00.000Z' }
    );
    expect(r.envelope.data.crashes.map((c) => c.id)).toEqual(['r-new']);
    expect(r.envelope.data.since).toBe('2026-09-05T00:00:00.000Z');
    // Neither claimed as in-window nor silently discarded.
    expect(r.envelope.data.unattributed).toBe(1);
  });

  it('rejects an unparseable --since instead of silently listing everything', async () => {
    const r = await handleCrashList(
      { deviceBridge: bridgeReturning(CRASHES), projectRoot: tmpRoot() },
      { since: 'yesterday' }
    );
    expect(r.exitKind).toBe('invalid_input');
    expect(r.envelope.ok).toBe(false);
    expect(r.envelope.error.message).toMatch(/since/i);
  });

  it('fails loudly when the engine cannot look — never ok:true with an empty list', async () => {
    const bridge = {
      listCrashes: async () => {
        throw new Error('mobilecli is not available or not working properly');
      },
    };
    const r = await handleCrashList({ deviceBridge: bridge, projectRoot: tmpRoot() });
    expect(r.exitKind).toBe('device');
    expect(r.envelope.ok).toBe(false);
    expect(r.envelope.error.kind).toBe('device');
    expect(r.envelope.error.message).toMatch(/mobilecli is not available/);
    expect(r.envelope.hint).toMatch(/mauto devices/);
    // The hint must not teach the engine's vocabulary to the user.
    expect(r.envelope.hint).not.toMatch(/mobile_/);
  });

  it('reports an honest empty list when the device genuinely has none', async () => {
    const r = await handleCrashList({ deviceBridge: bridgeReturning([]), projectRoot: tmpRoot() });
    expect(r.exitKind).toBe('ok');
    expect(r.envelope.data).toEqual({ crashes: [], count: 0, since: null, unattributed: 0 });
  });
});

describe('handleCrashGet', () => {
  const REPORT = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join('\n');
  const bridge = { getCrash: async () => REPORT };

  it('returns a bounded head by default and says so', async () => {
    const r = await handleCrashGet({ deviceBridge: bridge }, 'r1');
    expect(r.exitKind).toBe('ok');
    expect(r.envelope.data.crash_id).toBe('r1');
    expect(r.envelope.data.truncated).toBe(true);
    expect(r.envelope.data.report.split('\n')).toHaveLength(200);
    expect(r.envelope.data.report.startsWith('line 1')).toBe(true);
  });

  it('honours --full', async () => {
    const r = await handleCrashGet({ deviceBridge: bridge }, 'r1', { full: true });
    expect(r.envelope.data.truncated).toBe(false);
    expect(r.envelope.data.report.split('\n')).toHaveLength(300);
  });

  it('marks a short report untruncated', async () => {
    const r = await handleCrashGet({ deviceBridge: { getCrash: async () => 'boom' } }, 'r1');
    expect(r.envelope.data.truncated).toBe(false);
    expect(r.envelope.data.report).toBe('boom');
  });

  it('--out writes the FULL report to disk and returns the path, not the bytes', async () => {
    const dest = path.join(tmpRoot(), 'crash.txt');
    const r = await handleCrashGet({ deviceBridge: bridge }, 'r1', { out: dest });
    expect(r.exitKind).toBe('ok');
    expect(r.envelope.data.path).toBe(dest);
    expect(r.envelope.data).not.toHaveProperty('report');
    expect(fs.readFileSync(dest, 'utf8').split('\n')).toHaveLength(300);
  });

  it('reports an unwritable --out as an environment failure, not a device one', async () => {
    const r = await handleCrashGet({ deviceBridge: bridge }, 'r1', {
      out: path.join(tmpRoot(), 'no', 'such', 'dir', 'crash.txt'),
    });
    expect(r.exitKind).toBe('environment');
    expect(r.envelope.error.kind).toBe('environment');
  });

  it('propagates an engine failure as a device failure', async () => {
    const failing = {
      getCrash: async () => {
        throw new Error('crash report r1 not found');
      },
    };
    const r = await handleCrashGet({ deviceBridge: failing }, 'r1');
    expect(r.exitKind).toBe('device');
    expect(r.envelope.error.message).toMatch(/not found/);
  });
});

describe('gating', () => {
  const withEnv = (value, fn) => {
    const prev = process.env.MAUTO_OBSERVE;
    if (value === undefined) delete process.env.MAUTO_OBSERVE;
    else process.env.MAUTO_OBSERVE = value;
    try {
      return fn();
    } finally {
      if (prev === undefined) delete process.env.MAUTO_OBSERVE;
      else process.env.MAUTO_OBSERVE = prev;
    }
  };

  const hasCrash = () => Boolean(buildProgram().commands.find((c) => c.name() === 'crash'));

  it('does not register `crash` when the gate is unset', () => {
    expect(withEnv(undefined, hasCrash)).toBe(false);
  });

  it('registers `crash list` and `crash get` when MAUTO_OBSERVE=1', () => {
    withEnv('1', () => {
      const cmd = buildProgram().commands.find((c) => c.name() === 'crash');
      expect(cmd).toBeDefined();
      expect(cmd.commands.map((c) => c.name()).sort()).toEqual(['get', 'list']);
    });
  });

  it('registers `result add-crash` regardless of the gate', () => {
    // Not gated, deliberately: it is a complete device-free result writer, and
    // gating it would fail tests/lint/result-coverage.test.js, which calls
    // buildProgram() in a plain environment.
    for (const v of [undefined, '1']) {
      withEnv(v, () => {
        const resultCmd = buildProgram().commands.find((c) => c.name() === 'result');
        expect(resultCmd.commands.map((c) => c.name())).toContain('add-crash');
      });
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest tests/unit/cli/crash-verb.test.js
```

Expected: `handleCrashList is not a function`. The `result add-crash` gating test also fails until Task 5 — that is intentional; it pins the decision from the moment the decision is made.

- [ ] **Step 3: Write the implementation**

In `src/cli.js`, add the requires alongside the existing device/observe imports:

```js
const { crashTimestampMs } = require('./device/crash-model');
const { observeEnabled } = require('./observe/gate');
const { readHandle } = require('./device/session-handle');
```

Add the handlers next to the other device handlers (after `handleDevices`):

```js
// --- Crash diagnostics (slice 4) -----------------------------------------
//
// A DIAGNOSTIC verb, like `devices` / `session` / `memory` — deliberately NOT
// in src/device/action-catalog.js, which holds exactly the scenario-schema
// actions and whose lint guard asserts parity in both directions.

const CRASH_REPORT_HEAD_LINES = 200;
const CRASH_LIST_HINT =
  'The device engine could not read crash reports. Run `mauto devices` to confirm the device is reachable; crash reporting needs the helper binary that ships with the device engine.';

// Default watermark: when a device session is live, its handle already records
// started_at (src/device/session-daemon.js). Bind, do not copy — there is no new
// timestamp artifact and no second source of truth for "when did this session
// begin". No handle means no watermark, which means UNSCOPED, which the envelope
// reports as `since: null` rather than pretending the list is recent.
function sessionWatermark(projectRoot) {
  const handle = readHandle(projectRoot);
  const t = handle && handle.started_at;
  return typeof t === 'string' && Number.isFinite(Date.parse(t)) ? t : null;
}

// Split a crash list around a watermark. Reports whose own time is unreadable
// are neither included nor discarded — they are counted, so the caller can see
// that the device returned something the tool could not place in time.
function scopeCrashes(crashes, sinceMs) {
  if (sinceMs == null) return { crashes, unattributed: 0 };
  const inWindow = [];
  let unattributed = 0;
  for (const c of crashes) {
    const ms = crashTimestampMs(c);
    if (ms == null) unattributed += 1;
    else if (ms >= sinceMs) inWindow.push(c);
  }
  return { crashes: inWindow, unattributed };
}

async function handleCrashList({ deviceBridge, projectRoot }, opts = {}) {
  const sinceRaw = opts.since !== undefined ? opts.since : sessionWatermark(projectRoot);
  let sinceMs = null;
  if (sinceRaw != null) {
    sinceMs = Date.parse(sinceRaw);
    if (!Number.isFinite(sinceMs)) {
      return {
        envelope: fail(
          'invalid_input',
          `could not parse --since "${sinceRaw}" as a date`,
          'Pass an ISO 8601 timestamp, e.g. --since 2026-09-05T10:00:00Z.'
        ),
        exitKind: 'invalid_input',
      };
    }
  }

  let all;
  try {
    all = await deviceBridge.listCrashes();
  } catch (err) {
    // "Could not look" is NOT "found none". Reporting ok:true with an empty
    // list here would be this slice's own bug with the sign flipped.
    return {
      envelope: fail(err.kind || 'device', err.message || String(err), err.hint || CRASH_LIST_HINT),
      exitKind: err.kind || 'device',
    };
  }

  const { crashes, unattributed } = scopeCrashes(all, sinceMs);
  record({
    level: 'info',
    src: 'cli',
    event: 'crash.list',
    crash_count: Number.isFinite(crashes.length) ? crashes.length : undefined,
  });
  return {
    envelope: ok({
      crashes,
      count: crashes.length,
      since: sinceMs == null ? null : sinceRaw,
      unattributed,
    }),
    exitKind: 'ok',
  };
}

async function handleCrashGet({ deviceBridge, fs: fsDep = fs }, id, opts = {}) {
  let report;
  try {
    report = await deviceBridge.getCrash(id);
  } catch (err) {
    return {
      envelope: fail(err.kind || 'device', err.message || String(err), err.hint || CRASH_LIST_HINT),
      exitKind: err.kind || 'device',
    };
  }

  // --out writes the FULL report and returns only its path. This is how a
  // tens-of-kilobytes native tombstone reaches a result file without passing
  // through the agent's context window.
  if (opts.out) {
    try {
      fsDep.writeFileSync(opts.out, report);
    } catch (err) {
      return {
        envelope: fail(
          'environment',
          `could not write the crash report to ${opts.out}: ${err.message}`,
          'Check the directory exists and is writable.'
        ),
        exitKind: 'environment',
      };
    }
    return { envelope: ok({ crash_id: id, path: opts.out, truncated: false }), exitKind: 'ok' };
  }

  const lines = String(report).split('\n');
  const truncated = !opts.full && lines.length > CRASH_REPORT_HEAD_LINES;
  return {
    envelope: ok({
      crash_id: id,
      report: truncated ? lines.slice(0, CRASH_REPORT_HEAD_LINES).join('\n') : String(report),
      truncated,
    }),
    exitKind: 'ok',
  };
}
```

Register the commands inside `buildProgram`, immediately after the `devices` group (they are neighbours in kind, and the reader should find them together):

```js
  // Gated behind MAUTO_OBSERVE=1 per the observability design's slice ladder.
  // Registration, not a stub: with the gate unset `mauto crash list` is an
  // unknown command and lands as the usual invalid_input envelope, so a partly
  // built capability is ABSENT rather than present-and-broken. The graduation
  // PR deletes this branch and the one in connectBridge together.
  if (observeEnabled(process.env)) {
    const crash = program
      .command('crash')
      .description('Diagnostics: crash reports currently readable on the device');

    crash
      .command('list')
      .description('List crash reports, scoped to the current device session by default')
      .option('--device <id>', 'target device id')
      .option('--since <iso>', 'only reports at or after this ISO timestamp (default: session start)')
      .action(withEnvelope((opts) =>
        connectBridge(resolveVerbDevice(opts.device), (bridge) =>
          handleCrashList(
            { deviceBridge: bridge, projectRoot },
            opts.since === undefined ? {} : { since: opts.since }
          )
        )
      ));

    crash
      .command('get <id>')
      .description('Fetch one crash report (head by default)')
      .option('--device <id>', 'target device id')
      .option('--full', 'return the whole report instead of its head')
      .option('--out <path>', 'write the full report to a file and return its path')
      .action(withEnvelope((id, opts) =>
        connectBridge(resolveVerbDevice(opts.device), (bridge) =>
          handleCrashGet({ deviceBridge: bridge }, id, { full: opts.full, out: opts.out })
        )
      ));
  }
```

Export both handlers from `src/cli.js` alongside the existing handler exports.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest tests/unit/cli/crash-verb.test.js -t 'handleCrash'
npx jest tests/unit/cli/crash-verb.test.js -t 'gating' 
```

Expected: the `handleCrash*` blocks are green. In `gating`, the two `crash`-registration tests are green and the `result add-crash` test still fails until Task 5.

- [ ] **Step 5: Add the ungated-absence integration assertion**

Append to `tests/integration/cli-smoke.test.js`, in the style the file already uses to shell out to the real binary:

```js
test('`mauto crash list` is absent, and envelope-shaped, when the gate is unset', () => {
  const out = runCli(['crash', 'list'], { env: { ...process.env, MAUTO_OBSERVE: '' } });
  // The point is not the exit code but that an ungated user gets ONE JSON
  // envelope on stdout and never a bare commander error (#146).
  const parsed = JSON.parse(out.stdout);
  expect(parsed.ok).toBe(false);
  expect(parsed.error.kind).toBe('invalid_input');
  expect(out.status).toBe(3);
});
```

Adapt `runCli` to whatever helper that file already defines — do not introduce a second spawn helper.

- [ ] **Step 6: Run the CLI suites and commit**

```bash
npx jest tests/unit/cli tests/integration
```

```bash
git add src/cli.js tests/unit/cli/crash-verb.test.js tests/integration/cli-smoke.test.js
git commit -m "feat(cli): add the gated \`mauto crash list|get\` diagnostic verb

Fails loudly when the engine cannot look — 'could not ask' is never reported as
'found none'. Scoped by default to the live session's started_at, with undated
reports counted as unattributed rather than claimed or dropped. Registered only
under MAUTO_OBSERVE=1.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KmSR7wKHGdpze7SVzuqg26"
```

---

### Task 5: The failure-path auto-check

The payoff. When `mauto tap` fails or `mauto elements` comes back empty, the agent finds out whether the app is still alive before it reasons about a UI change.

The probe lives in its own module and `connectBridge` gains **one inserted line**. That is a deliberate blast-radius decision: slice 3 also edits `connectBridge` (screenshot-on-failure, in the same window — after `fn(bridge)` returns, before the `finally` calls `close()`), and a one-line insertion composes with whatever shape slice 3 chose without a merge argument. **Before writing this task, read `connectBridge` as it actually stands** — if slice 3 has already added a post-`fn` failure block, put the probe call inside it; do not add a second post-`fn` block.

Two exclusions the probe enforces, both load-bearing:

- **`devices` is exempt.** `handleDevices` returns a *bare array* through `connectBridge`, exactly like `handleElements` — so an empty-array trigger written without a verb check would fire on "no devices connected" and then try to probe crashes on a device that does not exist. `PROBE_EXEMPT_VERBS` names it.
- **Only `elements` triggers on empty.** Every other verb returns an object, but relying on that is relying on an accident. The trigger names the verb.

A connect failure never reaches the probe: `connectBridge`'s first `catch` returns before any bridge exists, which is also the only window in which one does.

**Files:**
- Create: `src/device/failure-probe.js`
- Modify: `src/cli.js` (one inserted line in `connectBridge`)
- Test: `tests/unit/device/failure-probe.test.js` (create)

**Interfaces:**
- Consumes: `DeviceBridge#listCrashes`, `crashTimestampMs`, `observeEnabled`, `record`, `readHandle`.
- Produces: `failure-probe.probeCrashes({ bridge, envelope, verb, projectRoot, env, now, timeoutMs }) => Promise<void>` — mutates the envelope in place when, and only when, it has something it earned; never throws.
- Also produces: `failure-probe.shouldProbe({ envelope, verb }) => boolean`, `failure-probe.CRASH_PROBE_TIMEOUT_MS`, `failure-probe.PROBE_EXEMPT_VERBS`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/device/failure-probe.test.js`:

```js
'use strict';

const { probeCrashes, shouldProbe, CRASH_PROBE_TIMEOUT_MS } = require('../../../src/device/failure-probe');

const ON = { MAUTO_OBSERVE: '1' };
const failEnv = (kind = 'device') => ({
  ok: false,
  error: { kind, message: 'element not found' },
  hint: 'Check the element is on screen.',
  schema_version: '2.1',
});
const okElements = (items) => ({ ok: true, data: items, schema_version: '2.1' });

const recent = { id: 'r1', process: 'com.acme.app', timestamp: '2026-09-05T10:30:00.000Z' };
const stale = { id: 'r0', process: 'com.acme.app', timestamp: '2026-08-01T10:30:00.000Z' };
const WATERMARK = '2026-09-05T10:00:00.000Z';

describe('shouldProbe', () => {
  it('fires on a device-kind and a timeout-kind failure', () => {
    expect(shouldProbe({ envelope: failEnv('device'), verb: 'tap' })).toBe(true);
    expect(shouldProbe({ envelope: failEnv('timeout'), verb: 'tap' })).toBe(true);
  });

  it('does not fire on non-device failures — those never mean the app died', () => {
    for (const kind of ['invalid_input', 'target_not_found', 'environment', 'internal']) {
      expect(shouldProbe({ envelope: failEnv(kind), verb: 'tap' })).toBe(false);
    }
  });

  it('does not fire on a successful action — the hot path stays untouched', () => {
    expect(shouldProbe({ envelope: { ok: true, data: { tapped: [1, 2] } }, verb: 'tap' })).toBe(false);
  });

  it('fires on an EMPTY elements list, which is the silent symptom of a dead app', () => {
    expect(shouldProbe({ envelope: okElements([]), verb: 'elements' })).toBe(true);
    expect(shouldProbe({ envelope: okElements([{ label: 'OK' }]), verb: 'elements' })).toBe(false);
  });

  it('never fires for `devices`, which also returns a bare array', () => {
    // `mauto devices` with nothing connected returns ok:[] through the same
    // seam. Probing there would mean asking a device that does not exist.
    expect(shouldProbe({ envelope: okElements([]), verb: 'devices' })).toBe(false);
    expect(shouldProbe({ envelope: failEnv('device'), verb: 'devices' })).toBe(false);
  });

  it('is total against a missing or malformed envelope', () => {
    expect(shouldProbe({ envelope: null, verb: 'tap' })).toBe(false);
    expect(shouldProbe({ envelope: undefined, verb: undefined })).toBe(false);
    expect(shouldProbe({ envelope: { ok: false }, verb: 'tap' })).toBe(false);
  });
});

describe('probeCrashes', () => {
  const opts = (bridge, extra = {}) => ({
    bridge,
    verb: 'tap',
    projectRoot: '/nope',
    env: ON,
    watermark: WATERMARK,
    sinks: [],
    ...extra,
  });

  it('attaches the crashes and amends the hint when the app died', async () => {
    const envelope = failEnv();
    const originalHint = envelope.hint;
    await probeCrashes(opts({ listCrashes: async () => [recent] }, { envelope }));
    expect(envelope.data.crashes).toEqual([recent]);
    expect(envelope.hint).toContain(originalHint);
    expect(envelope.hint).toMatch(/crash/i);
    expect(envelope.hint).toContain('mauto crash get');
  });

  it('leaves the original failure completely intact', async () => {
    const envelope = failEnv();
    await probeCrashes(opts({ listCrashes: async () => [recent] }, { envelope }));
    expect(envelope.ok).toBe(false);
    expect(envelope.error).toEqual({ kind: 'device', message: 'element not found' });
    expect(envelope.schema_version).toBe('2.1');
  });

  it('attaches an EARNED empty list when the device answered "none"', async () => {
    const envelope = failEnv();
    await probeCrashes(opts({ listCrashes: async () => [] }, { envelope }));
    expect(envelope.data.crashes).toEqual([]);
  });

  it('attaches NOTHING when the probe could not look', async () => {
    // The three-state contract: no `crashes` key means "unknown", and must not
    // be confused with the earned empty list above.
    const envelope = failEnv();
    const before = JSON.stringify(envelope);
    await probeCrashes(
      opts({ listCrashes: async () => { throw new Error('mobilecli is not available'); } }, { envelope })
    );
    expect(JSON.stringify(envelope)).toBe(before);
  });

  it('attaches NOTHING when there is no watermark to attribute against', async () => {
    const envelope = failEnv();
    const before = JSON.stringify(envelope);
    await probeCrashes(opts({ listCrashes: async () => [recent] }, { envelope, watermark: null }));
    expect(JSON.stringify(envelope)).toBe(before);
  });

  it('drops reports that predate the watermark — an old iOS report is not this crash', async () => {
    const envelope = failEnv();
    await probeCrashes(opts({ listCrashes: async () => [stale, recent] }, { envelope }));
    expect(envelope.data.crashes.map((c) => c.id)).toEqual(['r1']);
  });

  it('gives up on its own deadline rather than inheriting the daemon 25s timeout', async () => {
    const envelope = failEnv();
    const before = JSON.stringify(envelope);
    const hang = { listCrashes: () => new Promise(() => {}) };
    const started = Date.now();
    await probeCrashes(opts(hang, { envelope, timeoutMs: 20 }));
    expect(Date.now() - started).toBeLessThan(1000);
    expect(JSON.stringify(envelope)).toBe(before);
  });

  it('exposes a deadline shorter than one daemon call', async () => {
    // Derived, not restated: src/device/session-daemon.js:39 owns the 25s
    // number and exports it (:648). A hardcoded 25000 here would keep passing
    // after someone changed the daemon.
    const { DAEMON_CALL_TIMEOUT_MS } = require('../../../src/device/session-daemon');
    expect(CRASH_PROBE_TIMEOUT_MS).toBeLessThan(DAEMON_CALL_TIMEOUT_MS);
  });

  it('is inert when the gate is off', async () => {
    const envelope = failEnv();
    const before = JSON.stringify(envelope);
    let called = false;
    await probeCrashes(
      opts({ listCrashes: async () => { called = true; return [recent]; } }, { envelope, env: {} })
    );
    expect(called).toBe(false);
    expect(JSON.stringify(envelope)).toBe(before);
  });

  it('never throws, whatever the bridge does', async () => {
    for (const bridge of [null, {}, { listCrashes: null }, { listCrashes: () => { throw new Error('x'); } }]) {
      const envelope = failEnv();
      await expect(probeCrashes(opts(bridge, { envelope }))).resolves.toBeUndefined();
    }
  });

  it('sets the hint on an empty-elements OK envelope without touching data', async () => {
    const envelope = okElements([]);
    await probeCrashes(opts({ listCrashes: async () => [recent] }, { envelope, verb: 'elements' }));
    expect(envelope.data).toEqual([]); // still the elements array, unpolluted
    expect(envelope.hint).toMatch(/crash/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest tests/unit/device/failure-probe.test.js
```

Expected: the module does not resolve.

- [ ] **Step 3: Write the implementation**

Create `src/device/failure-probe.js`:

```js
'use strict';

// The failure-path crash check.
//
// Runs ONLY after an action has already failed, or after `mauto elements`
// returned an empty list. Never after a successful action: a round trip on
// every `mauto tap` would put a device call on the hot path, whereas checking
// after a failure costs nothing in the common case and answers the exact
// question that is otherwise unanswerable — "did the app die, or did the button
// move?".
//
// THE CONTRACT (see the slice-4 plan's "absent-versus-empty problem"): three
// states, not two.
//
//   crashes: [ … ]   we asked and the device reported crashes
//   crashes: []      we asked and the device reported none  — a POSITIVE claim
//   (no key)         we could not ask, or could not attribute — UNKNOWN
//
// Emitting `[]` when the probe failed, timed out or had no watermark would be
// this slice's own bug with the sign flipped: the tool would confidently tell
// the agent the app is fine when it has no idea. So the probe attaches a key it
// earned, or attaches nothing at all.
//
// It is TOTAL. It never throws, never rejects, and never alters ok, error or
// schema_version. An observability failure must not rewrite the caller's error.

const { crashTimestampMs } = require('./crash-model');
const { observeEnabled } = require('../observe/gate');
const { record } = require('../observe/recorder');
const { readHandle } = require('./session-handle');

// The probe's own budget, deliberately far below the daemon's per-call timeout.
// Inheriting that would add up to 25 seconds to a verb that has ALREADY failed,
// for a courtesy lookup the caller did not ask for.
const CRASH_PROBE_TIMEOUT_MS = 3000;

// `mauto devices` returns a bare array through the same connectBridge seam, so
// the empty-list trigger would fire on "nothing connected" and then try to probe
// a device that does not exist.
const PROBE_EXEMPT_VERBS = new Set(['devices']);

// Failure kinds that can plausibly mean "the app died". invalid_input is a bad
// flag, environment is a broken workspace, internal is our own bug — none of
// them are worth a device round trip.
const PROBE_KINDS = new Set(['device', 'timeout']);

function shouldProbe({ envelope, verb } = {}) {
  if (!envelope || typeof envelope !== 'object') return false;
  if (PROBE_EXEMPT_VERBS.has(verb)) return false;
  if (envelope.ok === false) {
    return PROBE_KINDS.has(envelope.error && envelope.error.kind);
  }
  // The silent symptom: the app is gone, so the view hierarchy is empty and the
  // verb still succeeds. Named by verb rather than by shape — relying on "only
  // `elements` returns a bare array" would be relying on an accident.
  return verb === 'elements' && Array.isArray(envelope.data) && envelope.data.length === 0;
}

function watermarkFor(projectRoot) {
  const handle = readHandle(projectRoot);
  const t = handle && handle.started_at;
  return typeof t === 'string' && Number.isFinite(Date.parse(t)) ? t : null;
}

function crashHint(crashes) {
  const process = crashes[0] && crashes[0].process;
  const who = process ? ` (${process})` : '';
  const id = crashes[0] && crashes[0].id;
  const how = id ? ` Run \`mauto crash get ${id}\` for the report.` : ' Run `mauto crash list`.';
  return `The app under test crashed during this session${who}: ${crashes.length} crash report(s).${how}`;
}

// Race a promise against a deadline WITHOUT leaving a live timer behind: a
// pending timer would keep a one-shot verb's event loop alive past its own exit.
function withDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(Symbol.for('mauto.probe.timeout')), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

async function probeCrashes({
  bridge,
  envelope,
  verb,
  projectRoot,
  env = process.env,
  watermark,
  timeoutMs = CRASH_PROBE_TIMEOUT_MS,
} = {}) {
  try {
    if (!observeEnabled(env)) return;
    if (!bridge || typeof bridge.listCrashes !== 'function') return;
    if (!shouldProbe({ envelope, verb })) return;

    const since = watermark === undefined ? watermarkFor(projectRoot) : watermark;
    if (since == null) {
      // No session handle means nothing to attribute against. An iOS
      // DiagnosticReports file from last Tuesday is not evidence about this
      // step, so say nothing rather than say something wrong.
      record({ level: 'debug', src: 'cli', event: 'crash.probe_unscoped', verb });
      return;
    }
    const sinceMs = Date.parse(since);

    const TIMED_OUT = Symbol.for('mauto.probe.timeout');
    const raw = await withDeadline(
      Promise.resolve().then(() => bridge.listCrashes()),
      timeoutMs
    );
    if (raw === TIMED_OUT) {
      record({ level: 'warn', src: 'cli', event: 'crash.probe_timeout', verb, dur_ms: timeoutMs });
      return;
    }

    const crashes = (Array.isArray(raw) ? raw : []).filter((c) => {
      const ms = crashTimestampMs(c);
      return ms != null && ms >= sinceMs;
    });

    record({
      level: crashes.length > 0 ? 'warn' : 'info',
      src: 'cli',
      event: crashes.length > 0 ? 'crash.detected' : 'crash.probe_clear',
      verb,
      crash_count: Number.isFinite(crashes.length) ? crashes.length : undefined,
      // app_id and message are sends:false — a crashed process name is an
      // unreleased product name and a stack excerpt is free text.
      app_id: (crashes[0] && crashes[0].process) || undefined,
    });

    // An EARNED result: we asked, the device answered, we attribute the answer.
    if (envelope.ok === false) {
      envelope.data = { ...(envelope.data || {}), crashes };
    }
    if (crashes.length > 0) {
      const note = crashHint(crashes);
      envelope.hint = envelope.hint ? `${note} ${envelope.hint}` : note;
    }
  } catch (err) {
    // Total by construction. A broken probe must never turn "tap failed:
    // element not found" into "tap failed AND crash probing is broken" — that
    // buries the error the caller actually needs.
    try {
      record({
        level: 'warn',
        src: 'cli',
        event: 'crash.probe_failed',
        verb,
        message: (err && err.message) || String(err),
      });
    } catch (_) {
      /* recorder is already total; this is belt and suspenders */
    }
  }
}

module.exports = {
  probeCrashes,
  shouldProbe,
  watermarkFor,
  CRASH_PROBE_TIMEOUT_MS,
  PROBE_EXEMPT_VERBS,
  PROBE_KINDS,
};
```

In `src/cli.js`, add the require:

```js
const { probeCrashes } = require('./device/failure-probe');
```

Then, in `connectBridge`, insert **one line** between `const r = await fn(bridge)` and `emit(r, humanFlag())`:

```js
    try {
      const r = await fn(bridge);
      // Failure-path only, gated, deadline-bounded, and TOTAL: it may add a
      // `crashes` key and amend the hint, and can do nothing else. The bridge is
      // still live here and will not be after the `finally` — this is the only
      // window. See src/device/failure-probe.js.
      await probeCrashes({ bridge, envelope: r.envelope, verb: resolvedVerb, projectRoot });
      emit(r, humanFlag());
    } finally {
      if (typeof close === 'function') await close();
    }
```

> **Composition with slice 3.** If slice 3 has already added a post-`fn` failure block here (screenshot-on-failure lives in the same window), put the `probeCrashes` call **inside** that block instead of adding a second one, and keep the ordering: probe first, screenshot second, so the screenshot is not what a crash probe waits behind.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest tests/unit/device/failure-probe.test.js tests/unit/cli
```

Expected: green. Run the whole `tests/unit/cli` directory — `connectBridge` is a hot path shared by twelve verbs and an unnoticed regression there is expensive.

- [ ] **Step 5: Commit**

```bash
git add src/device/failure-probe.js src/cli.js tests/unit/device/failure-probe.test.js
git commit -m "feat(device): check for app crashes on the failure path

After a device/timeout failure or an empty elements list — never after a
successful action, which would put a device round trip on the hot path. Bounded
by its own 3s deadline rather than the daemon's 25s, scoped to the live
session's started_at, and total: it attaches a crashes key it earned or attaches
nothing, and never rewrites the caller's error.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KmSR7wKHGdpze7SVzuqg26"
```

---

### Task 6: The crash record in the result file

The durable half. A crash the agent saw at 10:31 is worth nothing if the result file the QA lead reads tomorrow does not carry it.

**What the record contains, and what it deliberately does not.** Every field is `sends: false` by nature and none of them reaches the telemetry path in slice 5, because the result file is not on the telemetry path at all — only `src/observe/` events are, and the only crash field there is the integer `crash_count` (Task 1). Stated per field so the decision is reviewable:

| Field | Type | Why it is here | Why it never leaves the machine |
|---|---|---|---|
| `crash_id` | string | The handle for `mauto crash get`, so the full report is retrievable later. | Device-local report identifier. |
| `process` | string \| null | *The* fact: which package/bundle died. | An unreleased product's package name — the exact case `app_id: sends:false` was written for. |
| `timestamp` | string \| null | The device's own time for the report; what makes attribution checkable after the fact. | Device-local. |
| `detected_at` | string | When `mauto` observed it, so a reader can see the gap between crash and detection. | Bundled with the rest. |
| `step_id` | string \| null | Which step was in flight. | Names the user's feature under test. |
| `excerpt` | string \| null | Bounded head of the stack — the exception type and top frames, which is the diagnostic part. | Free text; may embed labels, paths, typed input. |
| `report_path` | string \| null | Where `mauto crash get --out` wrote the full report. | A filesystem path leaks usernames and project layout. |

`excerpt` is capped at **2000 characters, head-first**, and `ResultStore` enforces the cap rather than trusting the caller — a result file is read into an agent's context and frequently committed to a repo, and a 60 KB native tombstone inlined into JSON is a cost every future reader pays. The full report has a home: `report_path`.

`crashes` is written **only when non-empty**, so a run with no crashes produces a result file byte-identical to today's. That is what makes the field additive in practice as well as in schema, and it is why `result add-crash` does not need the gate.

**Files:**
- Modify: `src/schemas/result_schema.json`
- Modify: `src/result/store.js`
- Modify: `src/result/capability-catalog.js`
- Modify: `src/cli.js` (handler + `result add-crash` registration)
- Test: `tests/unit/result/store.test.js` (extend)
- Test: `tests/lint/result-coverage.test.js` (extend — one behavioral proof)

**Interfaces:**
- Consumes: nothing from the device layer — this task has no device dependency, by design.
- Produces:
  - result schema `properties.crashes` (array; `crash_id` required)
  - `ResultStore#addCrash({ crash_id, process, timestamp, step_id, excerpt, report_path })`
  - `handleResultAddCrash({ resultStoreFactory, projectRoot }, opts)`
  - `result add-crash` verb
  - `RESULT_CAPABILITIES.crash_record`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/result/store.test.js`:

```js
describe('addCrash', () => {
  const { ResultStore } = require('../../../src/result/store');

  const newStore = (runId) =>
    new ResultStore({ runId, scenarioId: 'login', projectRoot: tmpProjectRoot() });

  it('records a crash and carries it into the finalized result', () => {
    const store = newStore('run_20260905_000001');
    store.addStep({ step_id: 'step_3', status: 'fail' });
    store.addCrash({
      crash_id: 'r1',
      process: 'com.acme.app',
      timestamp: '2026-09-05T10:30:00.000Z',
      step_id: 'step_3',
      excerpt: 'FATAL EXCEPTION: main',
      report_path: 'mobile-automator/results/r1.txt',
    });
    const result = store.finalize({});
    expect(result.crashes).toEqual([
      {
        crash_id: 'r1',
        process: 'com.acme.app',
        timestamp: '2026-09-05T10:30:00.000Z',
        step_id: 'step_3',
        excerpt: 'FATAL EXCEPTION: main',
        report_path: 'mobile-automator/results/r1.txt',
        detected_at: expect.any(String),
      },
    ]);
  });

  it('omits `crashes` entirely when there were none — a clean run is byte-identical to today', () => {
    const store = newStore('run_20260905_000002');
    store.addStep({ step_id: 'step_1', status: 'pass' });
    expect(store.finalize({})).not.toHaveProperty('crashes');
  });

  it('requires a crash_id, because without it the full report is unreachable', () => {
    const store = newStore('run_20260905_000003');
    expect(() => store.addCrash({ process: 'com.acme.app' })).toThrow(/crash_id/i);
  });

  it('caps the excerpt at 2000 chars in the STORE, not in the caller', () => {
    // A result file gets read into an agent's context and committed to repos.
    // Trusting the caller to bound a native tombstone is how a 60KB blob ends
    // up inline in JSON forever.
    const store = newStore('run_20260905_000004');
    store.addCrash({ crash_id: 'r1', excerpt: 'x'.repeat(5000) });
    const result = store.finalize({});
    expect(result.crashes[0].excerpt).toHaveLength(2000);
    expect(result.crashes[0].excerpt.startsWith('xx')).toBe(true);
  });

  it('survives the one-shot process boundary via the in-progress file', () => {
    const root = tmpProjectRoot();
    const opts = { runId: 'run_20260905_000005', scenarioId: 'login', projectRoot: root };
    new ResultStore(opts).addCrash({ crash_id: 'r1', process: 'com.acme.app' });
    // A separate process would construct a fresh store against the same root.
    const result = new ResultStore(opts).finalize({});
    expect(result.crashes.map((c) => c.crash_id)).toEqual(['r1']);
  });

  it('nulls the optional fields rather than dropping them, so the shape is stable', () => {
    const store = newStore('run_20260905_000006');
    store.addCrash({ crash_id: 'r1' });
    const [crash] = store.finalize({}).crashes;
    expect(crash.process).toBeNull();
    expect(crash.timestamp).toBeNull();
    expect(crash.step_id).toBeNull();
    expect(crash.excerpt).toBeNull();
    expect(crash.report_path).toBeNull();
  });
});
```

Append to `tests/lint/result-coverage.test.js`, inside the existing `describe('behavioral: …')` block:

```js
    test('a crash supplied to addCrash reaches the finalized result', () => {
      const store = new ResultStore({ runId: 'run_20260101_000006', scenarioId: 's', projectRoot: tmpProjectRoot() });
      store.addStep({ step_id: 'step_1', status: 'fail' });
      store.addCrash({ crash_id: 'r1', process: 'com.acme.app', step_id: 'step_1' });
      const result = store.finalize({});
      expect(result.crashes[0].crash_id).toBe('r1');
      expect(result.crashes[0].process).toBe('com.acme.app');
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest tests/unit/result/store.test.js tests/lint/result-coverage.test.js
```

Expected: `store.addCrash is not a function`, and `result-coverage` additionally fails its *completeness* assertion once the schema field lands — which is precisely the guard doing its job. Add `tmpProjectRoot` to `store.test.js` if the file does not already define such a helper; do not add a second one if it does.

- [ ] **Step 3: Write the implementations**

In `src/schemas/result_schema.json`, add a root-level property (do **not** add it to `required` — that would break every existing result file, and slice 3's `result-schema-additive.test.js` exists to catch exactly that):

```json
    "crashes": {
      "type": "array",
      "description": "App crash reports observed during this run. Present only when at least one was observed, so a clean run's file is unchanged. Populated by `mauto result add-crash`, typically from `mauto crash list`.",
      "items": {
        "type": "object",
        "properties": {
          "crash_id": { "type": "string", "description": "Device-local report id; pass to `mauto crash get` for the full report" },
          "process": { "type": ["string", "null"], "description": "Package/bundle identifier of the process that died" },
          "timestamp": { "type": ["string", "null"], "description": "The device's own time for the report, when it reports one" },
          "detected_at": { "type": "string", "description": "ISO time at which mauto observed the report" },
          "step_id": { "type": ["string", "null"], "description": "Step in flight when the crash was observed" },
          "excerpt": { "type": ["string", "null"], "description": "Bounded head of the crash report (max 2000 chars); the full report lives at report_path" },
          "report_path": { "type": ["string", "null"], "description": "Path to the full report written by `mauto crash get --out`" }
        },
        "required": ["crash_id", "detected_at"]
      }
    },
```

In `src/result/store.js`:

```js
// A crash report is read into an agent's context and routinely committed to a
// repo. A native tombstone is tens of kilobytes, so the excerpt is bounded HERE
// rather than trusted from the caller — the full report's home is report_path.
const MAX_CRASH_EXCERPT = 2000;
```

Add `this._crashes = loaded.crashes || [];` to `_refreshFromDisk()`, add `crashes: this._crashes,` to the `_persistInProgress()` snapshot, and add the mutator after `addAssertion`:

```js
  addCrash({ crash_id, process = null, timestamp = null, step_id = null, excerpt = null, report_path = null } = {}) {
    return withLock(this._lock, () => {
      this._refreshFromDisk();
      if (!crash_id || String(crash_id).trim() === '') {
        // Without an id the full report is unreachable, which makes the record
        // a claim nobody can check.
        throw new Error('addCrash requires a crash_id');
      }
      const entry = {
        crash_id: String(crash_id),
        process: process == null ? null : String(process),
        timestamp: timestamp == null ? null : String(timestamp),
        detected_at: new Date().toISOString(),
        step_id: step_id == null ? null : String(step_id),
        excerpt: excerpt == null ? null : String(excerpt).slice(0, MAX_CRASH_EXCERPT),
        report_path: report_path == null ? null : String(report_path),
      };
      this._crashes.push(entry);
      this._persistInProgress();
      return entry;
    });
  }
```

In `finalize()`, after building `result` and before the write — conditional, so a clean run's file is unchanged:

```js
      // Present only when non-empty. That is what makes `crashes` additive in
      // PRACTICE and not merely in schema: a run with no crashes emits exactly
      // the file it emitted before this field existed.
      if (this._crashes.length > 0) result.crashes = this._crashes;
```

In `src/result/capability-catalog.js`, add to `RESULT_CAPABILITIES`:

```js
  crash_record: {
    verb: 'add-crash',
    flags: ['--crash-id', '--process', '--crash-timestamp', '--excerpt', '--report-path'],
    store: 'addCrash',
    writes: 'this._crashes.push(entry)',
    writeCheck: 'substring',
    schemaPointer: '/properties/crashes',
  },
```

> `--step-id` is NOT listed: it identifies *which step* the record attaches to, exactly like `add-step`'s and `add-assertion`'s, and `IDENTITY_FLAGS` already covers it. `--crash-timestamp` rather than `--timestamp` because the value is the *device's* time for the report, distinct from `detected_at`, and an unqualified `--timestamp` on a verb that also stamps its own would be read wrong at least once.

In `src/cli.js`, add the handler next to the other result handlers:

```js
function handleResultAddCrash({ resultStoreFactory, projectRoot }, opts = {}) {
  const store = resultStoreFactory({
    runId: opts.runId,
    scenarioId: opts.scenarioId,
    projectRoot,
  });
  const entry = store.addCrash({
    crash_id: opts.crashId,
    process: opts.process,
    timestamp: opts.crashTimestamp,
    step_id: opts.stepId,
    excerpt: opts.excerpt,
    report_path: opts.reportPath,
  });
  return { envelope: ok({ crash: entry }, storeHint(store)), exitKind: 'ok' };
}
```

`storeHint` (`src/cli.js:696`) already collapses a store's recovery warnings into an envelope hint for the other result verbs — reuse it verbatim; do not write a second one.

Register it in the `result` group, after `add-assertion`. **Not gated** — see "How the verb is gated":

```js
  result
    .command('add-crash')
    .description('Record an app crash observed during the run')
    .requiredOption('--run-id <id>', 'run identifier (run_YYYYMMDD_HHMMSS)')
    .option('--scenario-id <id>', 'scenario identifier')
    .requiredOption('--crash-id <id>', 'device-local report id (from `mauto crash list`)')
    .option('--step-id <id>', 'step in flight when the crash was observed')
    .option('--process <name>', 'package/bundle identifier of the process that died')
    .option('--crash-timestamp <iso>', "the device's own time for the report")
    .option('--excerpt <text>', 'head of the crash report (stored capped at 2000 chars)')
    .option('--report-path <path>', 'path to the full report written by `mauto crash get --out`')
    .action(withEnvelope((opts) => {
      const r = handleResultAddCrash(
        { resultStoreFactory, projectRoot },
        {
          runId: opts.runId,
          scenarioId: opts.scenarioId,
          crashId: opts.crashId,
          stepId: opts.stepId,
          process: opts.process,
          crashTimestamp: opts.crashTimestamp,
          excerpt: opts.excerpt,
          reportPath: opts.reportPath,
        }
      );
      emit(r, humanFlag());
    }));
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest tests/unit/result tests/lint/result-coverage.test.js tests/lint/result-schema-additive.test.js tests/unit/cli/crash-verb.test.js
```

Expected: all green, including the `result add-crash` gating test from Task 4 and slice 3's additivity guard. If `tests/lint/result-schema-additive.test.js` is absent, slice 3 has not landed — **stop and say so** rather than creating it here.

- [ ] **Step 5: Commit**

```bash
git add src/schemas/result_schema.json src/result/store.js src/result/capability-catalog.js src/cli.js \
        tests/unit/result/store.test.js tests/lint/result-coverage.test.js
git commit -m "feat(result): carry observed app crashes in the result file

Root-level additive \`crashes\`, written only when non-empty so a clean run's
file is unchanged. ResultStore.addCrash caps the excerpt at 2000 chars rather
than trusting the caller. Bound by a capability-catalog entry, so a crash record
with no verb to fill it would fail the build (#140's lesson).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KmSR7wKHGdpze7SVzuqg26"
```

---

### Task 7: Teach the execute guide, and only the execute guide

Reasoning is pulled, never ambient. Crash handling belongs in `mauto guide execute`, which an agent pulls when it is about to replay a scenario — not in the bootstrap verb map, which is the always-loaded floor and must not advertise a gated verb.

Both mode variants must be updated: the guides are emitted per mode and the lint guards read them separately. The prose must name **no OS** in the agnostic file, no `mobile_*` tool name in either, and leave no `{{placeholder}}` behind.

**Files:**
- Modify: `src/guide/content/execute.aware.md`
- Modify: `src/guide/content/execute.agnostic.md`
- Modify: `TROUBLESHOOTING.md`
- Test: `tests/lint/guide-*.test.js` (run, not modified)

**Interfaces:**
- Consumes: the verb surface from Tasks 4 and 6.
- Produces: no code.

- [ ] **Step 1: Add the crash section to both execute guides**

Append to `src/guide/content/execute.aware.md`, under the existing failure-handling material:

```markdown
### When a step fails, find out whether the app is still alive

An action that fails, or an `elements` call that comes back empty, has two very
different explanations: the UI changed, or the app died. They lead to opposite
conclusions, and only one of them is worth reporting as a test failure.

When `MAUTO_OBSERVE=1` is set, `mauto` checks for you. A failed device action
comes back with a `crashes` array in `data`, and the `hint` names the process
that died. Three states, and they are not the same:

- `crashes` present and non-empty — the app crashed. Stop reasoning about the
  UI. Record it and stop the run.
- `crashes` present and empty — the app is alive. This is a real UI failure;
  carry on diagnosing it.
- `crashes` absent — `mauto` could not check. Nothing has been claimed either
  way; reason as you would have without it.

To ask directly, at any time:

```bash
mauto crash list                     # reports since this device session began
mauto crash list --since <iso>       # a window you choose
mauto crash get <id>                 # the head of one report
mauto crash get <id> --out <path>    # the whole report to a file
```

Record what you found so the result file carries it:

```bash
mauto result add-crash --run-id <run> --crash-id <id> --step-id <step> \
  --process <package> --excerpt "<first lines of the report>"
```

Two cautions. Crash-report retention differs between platforms: on some the
reports age out of a device log within minutes, on others they are files that
persist for weeks. That is why `crash list` scopes to the current session by
default — a report from last week is not evidence about this step. And a report
whose own timestamp is unreadable is counted in `unattributed` rather than
included; if that count is non-zero, widen `--since` and look yourself.
```

Append the same section to `src/guide/content/execute.agnostic.md`, with one change: the retention paragraph must name no OS. Use "*retention differs between device platforms — on some, reports age out of a device log within minutes; on others they persist as files for weeks*", which is already how the text above is phrased. Verify with the guard, not by eye.

- [ ] **Step 2: Run the guide guards**

```bash
npm run lint:guides
```

Expected: green. `guide-agnostic-no-os.test.js`, `guide-no-mcp-tool-leak.test.js` and `guide-no-placeholder-leak.test.js` all have jurisdiction over this text. If the agnostic guard trips, the fix is to remove the OS word — never to relax the guard.

`execute.invariants.md` is deliberately **not** touched: it is the placeholder-free, OS-free skill floor, and a gated verb does not belong in an installed Agent Skill.

- [ ] **Step 3: Add the TROUBLESHOOTING entry**

In `TROUBLESHOOTING.md`, add a new section after the daemon material:

````markdown
### ❓ "Element not found" — but did the app crash?

`mauto` cannot tell you from the error alone: a missing element and a dead app
produce the same message. With `MAUTO_OBSERVE=1`, a failed device verb carries
the answer in its envelope, and you can ask directly:

```bash
mauto crash list                  # scoped to the current device session
mauto crash get <id> --out /tmp/crash.txt
```

Read the envelope carefully — `crashes: []` and no `crashes` key are different
answers. The empty array means the device was asked and reported none. A missing
key means `mauto` could not ask: the device engine's crash helper was
unavailable, the lookup exceeded its 3-second budget, or there was no device
session to scope the reports against. In the last case, `mauto session start`
first and re-run.

Structured detail for any of those is in the event log:

```bash
grep -E '"event":"crash\.' mobile-automator/.logs/mauto.ndjson
```
````

- [ ] **Step 4: Commit**

```bash
git add src/guide/content/execute.aware.md src/guide/content/execute.agnostic.md TROUBLESHOOTING.md
git commit -m "docs: teach crash triage in the execute guide and TROUBLESHOOTING

Pulled, not ambient: the crash verb is documented in \`mauto guide execute\`, not
in the bootstrap verb map, which is the always-loaded floor and must not
advertise a gated verb. Both mode variants updated; the skill invariants file is
deliberately untouched.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KmSR7wKHGdpze7SVzuqg26"
```

---

### Task 8: Version bump, changelog, verification, PR

**Files:**
- Modify: `package.json` (version), `package-lock.json`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: everything above.
- Produces: no code.

- [ ] **Step 1: Bump the version**

The CI gate `Verify version is bumped` fails any PR touching `src/`, `bin/` or `package.json` without a version not already in `git tag`. Slice 3 took this branch to `0.25.0-rc.2`, so slice 4 increments the rc counter. In `package.json`, set `"version": "0.25.0-rc.3"`, then:

```bash
npm install --package-lock-only
```

- [ ] **Step 2: Write the changelog**

Append to the existing `### ✨ Added` block under `## [Unreleased]` in `CHANGELOG.md` (slices 1–3's entries stay; under gate-then-graduate each slice appends and the graduation PR collapses the block into a release section):

```markdown
- Crash visibility, behind `MAUTO_OBSERVE=1`. mobile-mcp has exposed crash-report
  primitives all along and `mauto` called neither of them, so an app that died
  mid-scenario looked to an agent exactly like a button that moved. Now:
  `mauto crash list` (scoped to the current device session by default, or a
  `--since` window you choose) and `mauto crash get <id>` (head by default,
  `--full` for everything, `--out <path>` to write the whole report to a file
  and keep it out of the agent's context).
- An automatic crash check on the **failure path only** — after a device or
  timeout failure, or after `mauto elements` returned empty. Never after a
  successful action: that would put a device round trip on the hot path of every
  `mauto tap`, whereas checking after a failure costs nothing in the common case.
  It is bounded by its own 3-second budget rather than the session daemon's
  25-second per-call timeout, and it can only add a `crashes` key and amend the
  `hint` — it never rewrites the failure you were actually looking at.
- Three states, not two, and the distinction is the point. `crashes: []` means
  the device was asked and reported none — a positive claim that the app is
  alive. **No `crashes` key at all** means `mauto` could not ask, or could not
  attribute what it got to this session. Reporting an empty list in that case
  would be the same confident-wrong-answer bug this release fixes, with the sign
  flipped, so the check attaches a key it earned or attaches nothing.
- `crashes` in the result schema — an additive root-level array written only when
  non-empty, so a clean run's result file is byte-identical to before. Supplied
  by `mauto result add-crash` (**not** gated: it is a complete, device-free
  writer) and bound by a `capability-catalog` entry, so a crash field with no
  verb able to fill it fails the build instead of shipping empty (#140's lesson).
- Crash reports are scoped by time because retention is not symmetric across
  platforms: on one, reports age out of a device log within minutes; on another
  they are files that persist for weeks and accumulate across runs. An old report
  is not evidence about the step that just failed. Reports whose own timestamp is
  unreadable are counted as `unattributed` rather than claimed or silently
  dropped.
- One new telemetry-eligible field, `crash_count` — an integer. The crashed
  process name and the stack excerpt reuse the existing `app_id` and `message`
  entries, which are already `sends: false`, so nothing about a crash but its
  count can ever leave the machine.
```

- [ ] **Step 3: Run the full verification set and SHOW the output**

```bash
npm test
npm run lint:guides
npm run lint:schema-additive
./scripts/pack-smoke.sh
```

Expected: all green. Do not claim completion without pasting this output — the project's workflow requires evidence before any success claim. Two results are worth calling out explicitly in the PR body because they are what this slice's hard constraints are about:

- `tests/lint/action-coverage.test.js` green ⇒ `crash` stayed out of the action catalog.
- `tests/lint/mobile-mcp-tool-coverage.test.js` green ⇒ the allowlist and the bridge agree in both directions.

- [ ] **Step 4: Commit and open a draft PR**

```bash
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore(release): bump to 0.25.0-rc.3 for crash visibility

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KmSR7wKHGdpze7SVzuqg26"
git push -u origin sh3lan93/observability-slice-2
```

Then open the draft PR, filling the test-plan numbers from the Step 3 output — do not invent them:

```bash
gh pr create --draft \
  --title "feat(observe): crash visibility — \`mauto crash\`, failure-path auto-check, result record" \
  --body-file <(cat <<'EOF'
## What

Slice 4 of the observability work (`docs/plans/2026-08-31-observability-design.md`).

- `DeviceBridge.listCrashes()` / `getCrash(id)` + the two allowlist entries, in one commit (the tool-coverage guard is bidirectional).
- `src/device/crash-model.js` — agnostic normalizer for a payload shape a transitively-resolved Go binary owns.
- `mauto crash list` / `mauto crash get`, gated behind `MAUTO_OBSERVE=1`.
- `src/device/failure-probe.js` — the failure-path-only check; `connectBridge` gains one line.
- Result-schema `crashes`, `ResultStore.addCrash`, `mauto result add-crash`, and the capability-catalog entry.

## Why

mobile-mcp 0.0.55 exposes `mobile_get_crash` and `mobile_list_crashes`, and `mauto` called neither. When the app under test dies mid-scenario the agent observes "element not found" and confidently reasons about a UI change. A QA tool that cannot distinguish "the app crashed" from "the button moved" produces confidently wrong test results.

## Design notes

**Three states, not two.** `crashes: []` is a positive claim that the app is alive. A missing `crashes` key means we could not ask. Collapsing those would reproduce the bug being fixed with the sign flipped, so the probe attaches a key it earned or attaches nothing — it never emits an empty array it did not earn.

**The probe has its own 3s deadline**, well below the daemon's 25s per-call timeout: inheriting that would add 25 seconds to a verb that has *already failed*, for a courtesy lookup nobody asked for.

**Time scoping is not incidental.** Crash-report retention is asymmetric — Android reports age out of a device log, iOS/simulator reports are files that persist and accumulate. The same list call is under-inclusive on one platform and over-inclusive on the other. The watermark reuses `session.json`'s existing `started_at`; no new artifact.

**No `action-catalog.js` entry.** That catalog holds exactly the 23 scenario-schema actions and its guard asserts parity in both directions. `crash` is a diagnostic verb, like `devices` / `session` / `memory`. `tests/lint/action-coverage.test.js` green is the evidence.

**No `no_crash` assertion type**, deliberately — a scenario-schema change with its own additivity implications, and not needed to answer "did the app die?".

**One new telemetry field.** `crash_count` (integer, `sends: true`). The process name reuses `app_id` and the stack excerpt reuses `message`, both already `sends: false` — reuse rather than a near-copy, so this slice adds one redaction decision to review instead of four.

**Gating.** `crash` and the auto-check are behind `MAUTO_OBSERVE=1`; `result add-crash` is not, because it is a complete device-free writer and gating it would fail `tests/lint/result-coverage.test.js`, which builds the program in a plain env.

## Test plan

<paste the Step 3 output>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01KmSR7wKHGdpze7SVzuqg26
EOF
)
```

---

## Self-review

Run before handing this plan to an implementer; findings were fixed inline.

**Spec coverage.** The design's "Crash / ANR detection" section names five obligations: the `crash` verb with `list`/`get` (Task 4), the `DeviceBridge` pair rather than a direct mobile-mcp call (Task 2), the failure-path-only auto-check (Task 5), no `action-catalog.js` entry (enforced by running `action-coverage.test.js` in Task 2 Step 4), and a `capability-catalog.js` entry for the crash record's home in the result schema (Task 6). All five are tasks. The design's "no `no_crash` assertion type" non-goal is honoured: nothing in this plan touches `scenario_schema.json`. The slice-ladder gate obligation is answered in its own section and enforced by tests in Task 4.

**Placeholder scan.** No "add appropriate error handling", no "similar to Task N", no "etc." standing in for a list. Every step carries runnable code. One place names something the implementer must read rather than assume, with an explicit instruction and a stop condition: `connectBridge`'s post-`fn` shape after slice 3 (Task 5 Step 3). Two earlier hedges were resolved by verifying against the source instead — `storeHint` (`src/cli.js:696`) and `DAEMON_CALL_TIMEOUT_MS` (exported from `src/device/session-daemon.js:648`, not `session-protocol.js`). `<paste the Step 3 output>` in the PR body is deliberate: inventing test numbers is the failure mode that instruction exists to prevent.

**Type consistency.** `normalizeCrashes` returns `{id, process, timestamp}` in Task 2 and every consumer reads exactly those three keys (`failure-probe.js`, `handleCrashList`, `crashHint`). `crashTimestampMs` returns `number|null` and both call sites null-check before comparing. The result record's keys (`crash_id`, `process`, `timestamp`, `detected_at`, `step_id`, `excerpt`, `report_path`) are identical across the schema, the store, the catalog flags and the CLI handler — note the deliberate rename at the CLI boundary (`--crash-timestamp` → `timestamp`), which is stated where it happens. `probeCrashes` returns `Promise<void>` and mutates; the tests assert `resolves.toBeUndefined()`, which matches.

**Two things flagged for the implementer, not resolved here.** (1) `tests/integration/cli-smoke.test.js`'s spawn helper is referred to as `runCli`; use whatever that file actually defines rather than adding a second one. (2) Task 6's store tests assume a `tmpProjectRoot` helper of the kind `result-coverage.test.js` already has; reuse the file's existing helper if one is there.

**One dependency that was not verifiable at writing time.** `docs/plans/2026-09-01-observability-slice-3-plan.md` did not exist when this plan was written, so slice 3's task list could not be read to confirm the interface. This plan therefore depends on slice 3 in exactly two places, both stated as guarantees rather than internals: the existence of `tests/lint/result-schema-additive.test.js` (Task 6 Step 4 stops if it is absent) and the *shape* of `connectBridge` after screenshot-on-failure (Task 5 Step 3 instructs the implementer to read it and insert one line into whatever is there). No code in this plan imports anything slice 3 creates.
