# Daemon lifecycle honesty — design (#156)

Closes #156 · Refs #168 (production-ready gate, Tier 2) · Branch `fix/156-daemon-lifecycle` · Target version `0.28.0`

## Intent

The device session daemon must be honest about its own lifecycle: it never
hangs forever, never leaves a useless process holding the workspace lock, and
never reports "stopped" or "running" when that is not true. The consumer is the
AI agent driving `mauto`, which branches on `session status` / `session end`
output — a false `stopped:true` or `running:true` sends it into a wedge it
cannot diagnose.

"Invisible engine death" — the fourth symptom in the issue title — is already
fixed by #176 / #180 (see the issue's status comment). This design closes the
other three plus the dead-engine status gap.

### Acceptance criteria (from #156)

1. A hung MCP initialize surfaces as a bounded `device` error (one-shot) or a
   daemon exit + released lock (daemon path), never an infinite hang.
2. A spawn readiness timeout leaves no live child holding the lock.
3. `session end` reports `stopped:true` only after the daemon is actually gone.
4. `session status` with a dead engine reports `running:false` and says why.
5. Full suite green; new tests cover each path with injected fakes (no real devices).

### Constraints

- Locked invariants hold: uniform envelope, one-shot verbs, device driven only via `mauto` verbs.
- Additive output only, except `stopped`, which becomes stricter (it is now only true when death is confirmed).
- POSIX only. Windows is out of scope (#165); the daemon already binds a Unix socket.

## Findings that shaped the design

Verified against the code at `4605c25` and the pinned dependencies:

- **Connect is bounded, but at 60s, not 15s.** `@modelcontextprotocol/sdk` 1.32.1
  sends `initialize` through `Protocol.request`, whose timeout defaults to
  `DEFAULT_REQUEST_TIMEOUT_MSEC = 60000`; on failure `Client.connect` already
  calls `close()`, which kills the child (stdin end → 2s → SIGTERM → 2s → SIGKILL).
  The spawner gives up at 15s, so the child holds the lock for up to 45s after
  the verb has already failed.
- **Measured:** mobile-mcp 1.0.5 completes `initialize` in ~200ms (3 runs:
  232/202/202ms) and closes in ~0.7s. Initialize touches no device.
- **`transport.onclose` fires on every child `'close'`** — real engine death *and*
  our own `client.close()`. Distinguishing the two needs an own-close flag.
- **The engine shares the daemon's process group.** The SDK spawns mobile-mcp
  without `detached`; the daemon is spawned `detached: true` and is therefore a
  group leader. Signalling `-pid` reaches daemon, engine and any `mobilecli`.
- **The daemon installs its SIGTERM handler only after `listen()`.** A SIGTERM
  during `createCall` takes the default action — no `'exit'` cleanup — leaving a
  stale lock that the next spawn's `cleanStale` removes (dead pid ⇒ stale).
- **Both spawn entry points share one readiness window.** `session start` and
  autostart (`resolve-connection.js:142`) both call `spawnDaemon` with its
  default `DEFAULT_READY_TIMEOUT_MS = 15000`.
- **`ERROR_CODES` and `STOP_REASONS` (`src/observe/vocab.js`) are closed lists**
  guarded bidirectionally; new values must be registered there.

## Decisions

| # | Decision | Rejected alternatives |
|---|---|---|
| D1 | On engine death the daemon **self-reaps** (`daemon.engine_exit`) and the next verb autostarts a fresh one | Report-only zombie (issue's literal proposal); hybrid with a last-stop-reason file |
| D2 | `CONNECT_TIMEOUT_MS = 10000`, readiness stays 15s; ordering pinned by test | Issue's 30s connect + ~35s readiness; SDK default 60s + spawn kill only |
| D3 | **No** daemon-side init deadline (`MAUTO_SESSION_INIT_DEADLINE_MS` dropped) | A ~14s self-deadline below readiness |
| D4 | `session end` escalates a daemon that outlives the budget (identity-checked SIGTERM → SIGKILL), then reports truthfully | Report-only `stopped:false`; SIGKILL without SIGTERM |
| D5 | Process termination lives in a new deep module `src/device/process-reaper.js` | Inline in each caller; add to `session-daemon.js` |

Rationale for D3: after D2 nothing in startup can hang — `mkdirSync` and the
`openSync('wx')` lock are synchronous, `cleanStale`'s `ps -p` is a local
`execFileSync`, `listen` on a Unix socket returns or errors immediately — and the
spawner's group kill (§3) is the outer bound regardless.

## Timeout ladder

All pinned in `tests/unit/device/timeout-invariant.test.js`:

```
CONNECT_TIMEOUT_MS (10s)  <  DEFAULT_READY_TIMEOUT_MS (15s)              — new
DAEMON_CALL_TIMEOUT_MS (25s)  <  client DEFAULT_TIMEOUT_MS (30s)          — existing
END_BUDGET_MS (= DAEMON_CALL_TIMEOUT_MS + 10s = 35s)
    >  DAEMON_CALL_TIMEOUT_MS + 4s (SDK close escalation)                 — new
```

`DEFAULT_READY_TIMEOUT_MS` becomes an export of `session-spawn.js` for the test.

## §1 Engine edge — `src/device/mobile-mcp-client.js`

```js
const CONNECT_TIMEOUT_MS = 10000;

createCall({
  device,
  connectTimeoutMs = CONNECT_TIMEOUT_MS,
  onEngineExit,                                   // optional; at most once; never for our own close()
  sdk = { Client, StdioClientTransport },         // test seam
  server = { command: process.execPath, args: [resolveServerEntry()] }, // test seam
}) → Promise<{ call, close }>
```

- **Bounded connect:** `await client.connect(transport, { timeout: connectTimeoutMs })`.
  An SDK `McpError` with code `RequestTimeout` is rethrown as a plain `Error`
  (`code: 'ENGINE_CONNECT_TIMEOUT'`, message
  `mobile-mcp did not finish initializing within <n>ms`). Other connect errors
  pass through unchanged.
- **The error never races the child.** The SDK's own cleanup is fire-and-forget
  (`void this.close()`), so on *any* connect failure `createCall` captures
  `transport.pid` (internal only — never returned), and before rethrowing awaits
  `reaper.waitForDeath(pid, { budgetMs: 5000 })`, then
  `reaper.terminate(pid, { group: false })` if it is still alive (the engine is
  not a group leader, so it is signalled by pid, never `-pid`). The 5s covers the SDK's own stdin-end → 2s → SIGTERM → 2s ladder.
  This is why commit ① (reaper) precedes ②.
- **Engine-exit signal:** before `connect`, set
  `client.onclose = () => { if (!closing && !reported) { reported = true; onEngineExit && onEngineExit(); } }`.
  `close()` sets `closing = true` before `client.close()`.
- **No engine pid is exposed.** D1 makes `onEngineExit` the single source of
  engine liveness.
- One-shot callers pass no `onEngineExit` and get only the bound.
- `server` defaults are resolved lazily inside `createCall`, preserving the
  "module loads without mobile-mcp installed" property.

## §2 Daemon self-reap — `src/device/session-daemon.js`

- `startDaemon` passes `onEngineExit: () => onEngineGone()` to `createCall`.
  Before startup completes, `onEngineGone` only sets `engineAlive = false`.
- **Engine died during startup:** after `listen` succeeds and **before** the
  handle/pidfile are written, `if (!engineAlive)` follows the existing
  listen-failure path: record `daemon.connect_failure` with
  `error_code: 'ENGINE_EXITED'`, `close()`, close the server, release the lock,
  throw. The bin's `main().catch` exits 1; the spawner sees a failed start. No
  handle is ever written for a dead engine.
- **After startup**, `onEngineGone` is rebound to:
  1. `engineAlive = false`;
  2. `safeObserve({ level: 'error', event: 'daemon.engine_exit', dur_ms })` — first, synchronously, like the crash guards;
  3. `stop('engine_exit')` — the existing path, unchanged (drain → destroy sockets → close server → `close()` → unlink → release lock → resolve `whenStopped`; the bin then `process.exit(0)`).
- In-flight calls are rejected by the SDK with `ConnectionClosed` and get their
  error reply before the drain completes; calls arriving while `stopping` get
  the existing stopping rejection.
- **Ping** reply becomes `{ pong, device, in_flight, engine_alive }`.

## §3 Process reaper + spawn kill

### `src/device/process-reaper.js` (new; pure, all effects injected)

```js
waitForDeath(pid, { budgetMs, pollMs = 100, isAlive = pidAlive, sleep }) → Promise<boolean>
terminate(pid, { group = true, graceMs = 2000, kill = process.kill, isAlive = pidAlive, sleep })
  → Promise<'dead' | 'survived'>
```

- `waitForDeath` resolves `true` as soon as `isAlive(pid)` is false, `false` once
  `budgetMs` elapses. `budgetMs: 0` is a single check.
- `terminate` sends SIGTERM to the target (`-pid` when `group`, else `pid`),
  waits up to `graceMs` for death, then SIGKILL to the same target, waits up to
  `graceMs` again, and reports. `group: true` is for a daemon (a group leader);
  `group: false` is for the engine child, which is not.
  `ESRCH` from `kill` ⇒ already dead ⇒ `'dead'`. `EPERM` ⇒ `'survived'`.
  A comment ties the group kill to `detached: true` in `session-spawn.js`.
- **No identity check inside** — callers decide whose pid it is.
- `pidAlive` is imported from `session-daemon.js` as the default; not moved.

### Spawn kill — `src/device/session-spawn.js`

New injectable `terminate = (pid) => reaper.terminate(pid, { group: true })`. On readiness
timeout only:

```js
if (child && child.pid && child.exitCode === null && child.signalCode === null) {
  const outcome = await terminate(child.pid);
  log.write(`mauto: daemon not ready after ${readyTimeoutMs}ms; terminated pid=${child.pid} (${outcome})\n`);
}
return false;
```

- Not run on spawn `'error'`, nor when the child already exited (an ELOCKED
  loser must never signal anything), nor when ready in time.
- Uses Node's own `ChildProcess` state, so no `pidIdentity` is needed here.
- `log.close()` stays in `finally`, after the kill. Return value unchanged.

## §4 `session end` / `session status` contract

### `connection.endSession(projectRoot, { client, reaper, identify, readPid, budgetMs = END_BUDGET_MS })`

```
pid   = readPid(pidfile)                       // before asking
acked = await client.requestShutdown(projectRoot)
if (!pid)  → acked ? { stopped:true,  forced:false }
                   : { stopped:false, already_stopped:true, forced:false }
if (await reaper.waitForDeath(pid, { budgetMs: acked ? budgetMs : 0 }))
           → acked ? { stopped:true, forced:false }
                   : { stopped:false, already_stopped:true, forced:false }
switch (identify(pid)):                        // pidIdentity
  'dead' | 'other' → acked ? { stopped:true, forced:false }
                           : { stopped:false, already_stopped:true, forced:false }
  'unknown'        → { stopped:false, pid }                 // never signal when unsure
  'ours'           → (await reaper.terminate(pid, { group: true })) === 'dead'
                       ? { stopped:true, forced:true }
                       : { stopped:false, pid }
```

- A daemon that does **not** ack but whose pidfile names a live daemon of ours is
  escalated with budget 0 — today that case is falsely reported `already_stopped:true`.
- A non-acking pidfile pointing at a dead or recycled pid is "nothing running".
- `END_BUDGET_MS` is exported from `connection.js`, derived from `DAEMON_CALL_TIMEOUT_MS`.

### `handleSessionEnd` envelopes

| Outcome | Envelope | `data` |
|---|---|---|
| Stopped cleanly | `ok` | `{ stopped:true, already_stopped:false, forced:false }` |
| Stopped by escalation | `ok` + hint `daemon did not exit after shutdown; terminated pid <n>. See <log>` | `{ stopped:true, already_stopped:false, forced:true }` |
| Nothing running | `ok` | `{ stopped:false, already_stopped:true, forced:false }` |
| Survived / unknown | `fail('device', 'device session daemon pid <n> did not exit', hint)`; hint names pid, pidfile, log | `{ stopped:false, already_stopped:false, pid }` |

### `getSessionStatus`

- Ping ok **and** `result.engine_alive === false` ⇒
  `{ running:false, reason:'engine_exited', in_flight, device }`; `handleSessionStatus`
  adds hint `the device engine exited; this session is shutting down and the next verb starts a fresh one. See <log>`.
- All other branches unchanged, with `reason: null` (field always present).
- Back-compat: a pre-0.28 daemon omits `engine_alive`; `undefined` ⇒ alive.

## §5 Telemetry, docs, version

**`src/observe/vocab.js`:** `EVENT_NAMES` += `'daemon.engine_exit'`;
`STOP_REASONS` += `'engine_exit'`; `ERROR_CODES` += `'ENGINE_CONNECT_TIMEOUT'`,
`'ENGINE_EXITED'`.

**Docs:**

| File | Change |
|---|---|
| `docs/reference/cli-verbs.md` | status shape gains `reason`; end waits, escalates, reports `forced`, can fail with `pid` |
| `docs/faq.md` | same two output shapes |
| `docs/reference/telemetry.md` | `stop_reason` list; `daemon.engine_exit`; new error codes |
| `TROUBLESHOOTING.md` | entries for `forced:true` / end failing with a pid, and `reason: engine_exited` |
| `CHANGELOG.md` | `[0.28.0]` — Fixed (the four symptoms), Changed (`session end` can fail; `forced`/`reason`) |

**Version:** `0.27.1 → 0.28.0` in `package.json` and `package-lock.json` (single-PR fix ⇒ graduated, no rc).

## Testing

| Test file | Covers |
|---|---|
| `tests/unit/device/process-reaper.test.js` (new) | SIGTERM suffices; SIGKILL after grace; survives both; `ESRCH` ⇒ dead; `EPERM` ⇒ survived; `group:true` signals `-pid`, `group:false` signals `pid`; `waitForDeath` true before / false at budget; budget 0 |
| `tests/unit/device/mobile-mcp-client-lifecycle.test.js` (new, fake SDK) | connect timeout ⇒ `ENGINE_CONNECT_TIMEOUT` + transport closed; timeout option forwarded; `onclose` ⇒ `onEngineExit` once; own `close()` ⇒ not called |
| `tests/integration/engine-lifecycle.test.js` (new, real SDK + fixtures) | `tests/fixtures/mcp-never-initializes.js` ⇒ real timeout, fixture process gone; `tests/fixtures/mcp-exits-after-init.js` ⇒ real `onEngineExit`; own close ⇒ none |
| `tests/unit/device/timeout-invariant.test.js` | the two new ladder rungs |
| `tests/unit/device/session-daemon-honesty.test.js` | engine exit ⇒ stopped, files gone, `engine_exit` then `stop{engine_exit}`; in-flight call gets its reply; ping during drain ⇒ `engine_alive:false`; death before listen ⇒ throws, no handle; shutdown frame ⇒ no `engine_exit` |
| `tests/unit/device/session-spawn.test.js` | timeout + live child ⇒ terminate + log line; exited child / spawn error / ready ⇒ no terminate |
| `tests/unit/device/connection.test.js` | every branch of the `endSession` tree |
| `tests/unit/cli.test.js` | the four `session end` envelopes (survivor ⇒ `fail`, exit kind `device`); status hint |
| `tests/unit/device/session-client.test.js` | `engine_alive:false` ⇒ `running:false, reason:'engine_exited'`; absent ⇒ running |

Verification before any completion claim: `npm test`, `npm run lint:guides`,
`npm run lint:schema-additive`, `./scripts/pack-smoke.sh` — output shown.

## Delivery

Commit order, each green on its own: ① reaper ② connect bound + engine-exit
signal + integration fixtures ③ spawn kill ④ daemon self-reap + ping + vocab
⑤ `session end` escalation ⑥ `session status` reason ⑦ docs + version + changelog.
Draft PR after ①, `Closes #156` on its own line, `Refs #168`.

## Out of scope

Windows (#165); relocating `pidAlive` / `pidIdentity`; the stale
`'crash' is documented but not yet produced` comment at `vocab.js:88`
(`onFatal` does call `stop('crash')`) — noted in the PR, not fixed.
