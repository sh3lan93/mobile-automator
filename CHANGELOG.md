# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.25.0]

### 🔧 Changed

- **CI verifies the supported Node range instead of asserting it.** `test.yml` pinned Node 18 in both jobs — the suite and the packed-tarball smoke check — while `engines` promised `>=18` and the README badge repeated it. Node 18 reached EOL in April 2025 and Node 20 in April 2026, so the one runtime under test was the one no user should still be running. The verification was not quite absent: `release.yml`'s `publish-npm` job runs `npm ci → npm test → pack-smoke.sh` on Node 22, so every published release did clear 22 — but only at publish time, which catches a regression after it has already landed on `main` rather than in review. Both `test.yml` jobs now run under a `fail-fast: false` matrix so a failure on one version cannot mask the others, and the daemon tests this matters most for are not mocked: they call the real `startDaemon()`, which binds an actual Unix domain socket and, in one case, forces a real `EADDRINUSE`. ([#162](https://github.com/sh3lan93/mobile-automator/issues/162))

---

## [0.24.0]

### 🐛 Fixed

- **Daemon crash diagnostics are captured instead of destroyed.** The session daemon was spawned with `stdio: 'ignore'`, so every diagnostic it wrote went to `/dev/null` as it was written — the missing-project-root and init-failure messages, the undeliverable-reply warning, and uncaught exceptions and unhandled rejections **with stack traces**. The loss ran a level deeper: `createCall` builds the mobile-mcp transport with no `stderr` option and the MCP SDK defaults that to `'inherit'`, so the *engine's* stderr inherited the daemon's fd 2 and was discarded too — taking the adb/simctl output that explains most field failures with it. A user whose daemon died got a 15s readiness timeout, a generic failure, and nothing else. `spawnDaemon` now opens `mobile-automator/.session/daemon.log` and hands that descriptor to the child as both stdout and stderr, which captures both layers at one spawn site. A spawn that fails to *exec* (EMFILE, EACCES, ENOENT on the bin) leaves the child with nothing to say, so the parent writes that error to the log itself rather than using it only to bail out of the readiness poll. The file is opened **append**, never truncated — lock-race losers exit `ELOCKED` through the same path and share it — and growth is bounded by rotating to `daemon.log.1` at 1 MiB, checked per spawn. Both the log open and the rotation are best-effort and degrade independently: a read-only workspace falls back to the previous `'ignore'` behavior, and a rotation that loses a race still yields a usable log, because an oversized log beats no log. `mauto session status` now reports `log_path`, computed locally from the workspace rather than from the daemon's `ping` reply, which returns its not-running shape precisely when the path is needed; `mauto session start` and the transparent-autostart path both name the log in their failure hints. ([#163](https://github.com/sh3lan93/mobile-automator/issues/163))

---

## [0.23.9]

### 🔒 Changed

- **npm publishing moved to trusted publishing (OIDC); the `NPM_TOKEN` secret is gone.** 0.23.8 published with a granular access token that had to be scoped to **All Packages**, because npm cannot scope a token to a package that does not exist yet — a broad, long-lived credential sitting in repository secrets purely to bootstrap the first release. That constraint is gone now that the package exists, so `publish-npm` authenticates with the workflow's own OIDC identity instead: npm exchanges the `id-token` for a short-lived publish grant via a trusted publisher configured on the package, naming this repository and this workflow file. Nothing long-lived remains, and there is nothing to rotate. The job moves from Node 18 to **Node 22**, and — because Node 22 LTS bundles npm 10.x while trusted publishing requires **npm >= 11.5.1** — npm is upgraded explicitly and the floor is asserted, so a future runner image change fails loudly at a named step rather than surfacing as an opaque authentication error at publish time. `--provenance` is kept deliberately: OIDC generates provenance regardless, but the explicit flag makes a failure to attest fail the publish rather than silently shipping an unattested tarball. Note the trust relationship names `release.yml` specifically — renaming that file, or moving the publish step into another workflow, breaks publishing until the trusted publisher is updated (`npm trust list mobile-automator`). ([#170](https://github.com/sh3lan93/mobile-automator/issues/170))

---

## [0.23.8]

### 🐛 Fixed

- **The release pipeline is reachable for the first time since v0.1.0.** `release.yml` had produced exactly one run in the repository's history — `v0.1.0` in February 2026, from a hand-pushed tag — so no tag from `v0.22.0` onward ever produced a GitHub Release or an npm publish, and nothing ever reported an error, because a workflow that is never triggered emits no failure. Two independent walls caused it. **(1)** `auto-tag.yml` pushed tags using the built-in `GITHUB_TOKEN`, and Actions deliberately does not start workflow runs from events raised with `GITHUB_TOKEN` (loop prevention) — the tag landed, the job printed `🏷️ Tag created and pushed`, and the push event reached nobody. Tags are now pushed with a **GitHub App installation token** (`actions/create-github-app-token`), a distinct identity whose pushes are not suppressed; it is preferred over a PAT because it is repo-scoped, lives about an hour, and needs no rotation. Missing App secrets hard-fail with an actionable message rather than falling back to `GITHUB_TOKEN`, since a fallback would recreate exactly the invisible breakage being fixed. **(2)** `release.yml` listened only for `push.tags`, so a Release created by hand from an existing tag — which pushes nothing, and therefore emits no tag-push event — could not trigger it either; `release: [published]` and `workflow_dispatch` are now accepted as entry points. The release job deliberately keeps `GITHUB_TOKEN`: that same suppression is what stops the Release it creates from re-triggering the workflow on `release: published`. A new `resolve` job validates that the ref is a `vX.Y.Z` tag and exports the version once for both jobs — `workflow_dispatch` can target a branch, which would otherwise resolve a version of `refs/heads/main` and publish it — and the release-candidate guard now reads that resolved version instead of `github.ref`, so a hyphen elsewhere in the ref cannot let an rc reach the registry. `actions/create-release@v1` (archived in 2021, `runs.using: node12`, a runtime current runners no longer provide, and hard-fails when the release already exists) is replaced by `softprops/action-gh-release@v2`, which updates in place so re-runs are safe. ([#170](https://github.com/sh3lan93/mobile-automator/issues/170))

---

## [0.23.7]

### 🐛 Fixed

- **Unset placeholders now render per slot kind, fixing doubled parens across the guides.** 0.23.4 addressed `{{build_command}}` by moving it out of its code span and making the fallback backtick-free, but the root cause was the fallback itself, not the code span: one context-blind string was substituted into 13 placeholder sites spanning five grammatical roles (label value, inline noun, parenthetical appositive, inline tail, whole section body), and no single string fits all of them. Because the fallback parenthesized itself while the surrounding prose also supplied parentheses, every appositive slot rendered doubled parens — `the app package ((not configured …))` — which affected the `{{app_package}}` and `{{loading_indicators}}` lines that 0.23.4 never touched, not just `{{build_command}}`. Unset placeholders now render per slot kind: **value** slots get a bare, unparenthesized note naming the key to set (`not configured — mauto config set build_command`, where the old text left `<key>` literal and never said which key was missing), and **optional** slots (`{{automation_extras}}`, `{{additional_resources}}`) render as nothing, so the automation line ends cleanly instead of having a note jammed onto the preceding word. The guard moved to the layer that owns the invariant: `tests/lint/guide-no-placeholder-leak.test.js` already emits every topic × mode with no config — precisely the unconfigured first-contact state — so it now also asserts no doubled parens, no fallback inside a code span, and no fallback jammed against the preceding word. The 0.23.4 guard that scanned raw content files could not see any of this, since every malformation exists only after interpolation; it is superseded and removed. ([#143](https://github.com/sh3lan93/mobile-automator/issues/143))

---

## [0.23.6]

### 🐛 Fixed

- **`mauto --version` is now owned by commander, so the POSIX `--` escape works again.** 0.23.4 introduced `--version` / `-V` as a hand-rolled `argv` pre-scan, duplicated in `bin/mauto.js` and `src/cli.js`. A scan such as `argv.some((a) => a === '--version')` is positionally blind, and in particular cannot honor `--`: that separator is a *state transition* in the parser — everything after it is an operand — not a token that can be matched. So the flag was hijacked even when supplied as a value: `mauto type -- --version` printed the version and exited 0 instead of typing the text, and **no** invocation could pass a literal `--version` / `-V` to `type`, `memory add`, `config set`, or `screenshot` — the value was unreachable through the CLI. It is now a single `.version(PKG_VERSION)` on the root program; `exitOverride` turns it into a `CommanderError` with code `commander.version`, which the denylist classification in 0.23.5 already treats as a display outcome. Commander tracks parser state, so `--` works again, and the flag now appears in `mauto --help`, where the hand-rolled version was invisible. ([#146](https://github.com/sh3lan93/mobile-automator/issues/146))

---

## [0.23.5]

### 🐛 Fixed

- **Commander failures are now classified by denylist, not allowlist — a truncated flag no longer fakes a crash.** 0.23.4 routed four commander error codes (`unknownOption`, `missingArgument`, `missingMandatoryOptionValue`, `unknownCommand`) to `invalid_input`. Commander v12 defines **13**, and the nine unlisted codes fell through to `internal` — which is not a neutral bucket: it maps to exit 1 and makes `diagnose()` dump a raw stack trace, the exact failure mode [#146](https://github.com/sh3lan93/mobile-automator/issues/146) exists to remove. One gap was live: `mauto result add-step --run-id` (flag supplied, value omitted — `optionMissingArgument`, a near-synonym of the handled `missingMandatoryOptionValue`) emitted `kind:"internal"`, exit 1, and a 10-frame stack trace, across all 60 value-taking options in the CLI. Three more were latent, reachable the moment the CLI adopts `.choices()`, `.conflicts()`, or `.error()`. `toEnvelope()` now classifies **any** `CommanderError` as `invalid_input` (exit 3) except the closed set of display outcomes (`help`, `helpDisplayed`, `version`), which `run()` short-circuits to commander's own exit code — the set of non-failures is closed and tiny, while the set of ways an invocation can be malformed grows with each commander release. A drift guard scans commander's own source for its error-code surface and fails the build if any code reaches `internal`, so a future commander upgrade cannot silently reopen the gap. ([#146](https://github.com/sh3lan93/mobile-automator/issues/146))

---

## [0.23.4]

### 🐛 Fixed

- **Commander parse errors now flow through the JSON envelope instead of bypassing it.** `mauto result add-step --run-id X --screenshot shot.png` used to print `error: unknown option '--screenshot'` as bare stderr text and exit 1 — commander detected the bad flag before any action callback ran, so the `{ok,data,error,hint,schema_version}` contract every host agent parses simply never emitted, and a malformed invocation was indistinguishable from a crashed device. `buildProgram()` now sets `exitOverride()` + `configureOutput({writeErr})` on the root program (inherited by every subcommand), and `toEnvelope()` classifies the four parse-failure codes (`unknownOption`, `missingArgument`, `missingMandatoryOptionValue`, `unknownCommand`) as `invalid_input` (exit 3) with commander's message preserved in `error` and the failing command's usage line in `hint`. `mauto --help` / `mauto --version` keep their human-readable output and exit 0, and `--human` renders parse failures readably. A guard suite asserts every parse-failure class produces JSON-parseable stdout. ([#146](https://github.com/sh3lan93/mobile-automator/issues/146))
- **Unset placeholders no longer interpolate inside code spans.** The not-configured fallback for `{{build_command}}` contained backticks of its own, and four guide lines placed the token inside a markdown code span — so on an unconfigured workspace (exactly a new user's first contact) the emitted guide rendered nested-backtick soup at the spot meant to show a command, and on two lines presented the fallback string itself as the command to run. Every `{{build_command}}` occurrence now sits outside the code span (the literal verb stays inside, the value outside, matching the `{{app_package}}` remedy), the fallback is backtick-free, and a new lint guard (`tests/lint/guide-no-placeholder-in-code-span.test.js`) fails if a placeholder is reintroduced inside a code span in any ported guide. ([#143](https://github.com/sh3lan93/mobile-automator/issues/143))
- **The platform-aware guides no longer pin `$schema_version` to `"2.0"`.** The aware `execute`/`generate` guides instructed agents to author scenarios at 2.0 while the shipped schema is 2.1 and the agnostic guides already said so — an agent following the aware guide produced files a strict 2.1 consumer rejects. Both pins now read `"2.1"`. ([#142](https://github.com/sh3lan93/mobile-automator/issues/142))

### ✨ Added

- **A real npm distribution pipeline.** The package has never been published (`npm view mobile-automator` → 404) even though the release workflow told users to `npm i -g mobile-automator`. `release.yml` gains a `publish-npm` job — guarded to graduated tags only (`vX.Y.Z`, never `-rc.N`) — that runs the full suite plus a packed-tarball smoke check before `npm publish --provenance --access public` (requires an `NPM_TOKEN` repo secret). A `prepublishOnly` script runs the test suite so a local publish can't skip it, and `scripts/pack-smoke.sh` (also a `test.yml` CI job) packs the tarball, installs it into a clean prefix, and verifies the installed `mauto` answers `--version`, emits parseable `schema scenario` JSON, and leaks no `{{placeholders}}` in `guide generate`.
- `mauto --version` / `-V` prints the installed package version and exits 0 (intercepted in `bin/mauto.js` so the commander program stays version-flag-free).
- **`tests/integration/` now exists** — `npm run test:integration` previously pointed at a missing directory and exited 1. The new `cli-smoke` suite spawns the real CLI in a temp workspace and covers `--version`, `validate` (ok envelope on a valid 2.1 scenario), `schema scenario`, `guide generate` (no surviving placeholders), and `config get` against a hand-written workspace config. Plain `npm test` picks it up, so the full suite stays one command.

---

## [Unreleased]

### 🐛 Fixed

- **The result store no longer loses steps when two `result` invocations race on the same run.** `src/result/store.js`'s mutators (`addStep`, `addObservation`, `addAssertion`, `captureVariable`, `finalize`) each did load → mutate → `atomicWrite`, and `atomicWrite` is atomic-rename — it protects readers from torn reads but is NOT a mutex, so two concurrent `result add-step` calls for one runId both loaded snapshot N, appended their own step, and the last rename won, silently dropping the other's step. The memory store next to it (`src/memory/store.js`) already solved this with an advisory lock (`src/memory/lock.js`, used via `_editUnderLock`); the result store never got the same treatment. The lock is now a shared util (`src/util/lock.js`, with `src/memory/lock.js` kept as a re-export shim so existing importers keep working), and every result mutator runs as a full read-modify-write under a **per-runId** advisory lock (`<runId>.lock` beside the result file). The load itself moved INSIDE the lock: the constructor still eager-loads for read-only paths and back-compat, but a mutator that trusted that snapshot would still clobber — two processes would cache the same stale state and serialize only their writes — so each mutator re-loads fresh-from-disk state under the lock before mutating and persisting. `selection.json` writes are atomic too (tmp + fsync + rename) instead of a bare `writeFileSync`. Corrupt-file detection still surfaces through the existing `warnings` channel whether it fires in the constructor or during an in-lock re-load.
  Closes #151

- **The envelope can no longer claim device B while every verb drives device A.** Two independent holes let the CLI lie about which device a session targets, and a third wedged the auto-resolve cache so the lie outlived the device. **(1) `session start --device B` against a running daemon** short-circuited on the "daemon alive" check and returned `already_running:true, device:B` — echoing back the *requested* device without ever reading the daemon's handle to compare the actual pin, so the agent proceeded believing the session targeted B while the daemon kept serving A. It now reads the handle pin (`readHandleDevice`, the same seam the connection resolver uses) and, when a specific `--device` is requested against a live daemon pinned to something else — including an unpinned/`auto` daemon, where B cannot be confirmed — fails with a `device` error whose hint says `Run \`mauto session end\` first, then \`mauto session start --device B\` to repin`; the agent stays in control, nothing is auto-restarted. Requesting no `--device`, or one that matches the pin, keeps the existing idempotent reuse. **(2) `mauto devices clear`** deleted only `selection.json`, but the daemon path resolves its target as `device || readHandleDevice(projectRoot)`, so the running daemon's handle still pinned A and verbs kept driving A after the "clear" — with no warning. The verb is now async and, when a daemon is alive, surfaces `daemon_still_pinned: <pin>` (or `null` for an unpinned/auto daemon) in the success envelope with a hint that `mauto session end` is required to actually switch; the handle file is deliberately left untouched, because the running daemon's in-memory pin is the truth and rewriting the file would create a lie between file and reality. **(3) `makeCall` cached the first auto-resolved device in `resolvedPromise` forever**, so when that device disconnected and a new one appeared every call failed `Device "X" not found` until the daemon restarted. A failed discovery no longer wedges the cache (the rejection clears it), and a `Device … not found` error on an **auto-resolved** (never user-pinned) device busts the cache and retries the call exactly once against a freshly re-resolved id — a pinned daemon never silently switches devices, and a retry that re-resolves to the same gone device rethrows instead of looping. ([#148](https://github.com/sh3lan93/mobile-automator/issues/148))
  Closes #148

- **The session daemon can no longer drop a device reply and silently double-execute.** The client's per-request timeout was 30s (`DEFAULT_TIMEOUT_MS`) while the daemon had NO per-call timeout at all, so a mobile-mcp call that hung past 30s was dropped by the client's own timeout — which reads as a false-failure and prompts the agent to retry, re-running an action that may already have hit the device (double tap / re-granted permission). The daemon now bounds every shared-connection call with `DAEMON_CALL_TIMEOUT_MS = 25000`, deliberately BELOW the client's 30s so the daemon's timeout error always wins the race and reaches the client as an honest `{ok:false, error:{kind:'timeout'}}` reply carrying a partial-execution hint ("the action may have partially executed on the device — verify state before retrying") instead of being dropped. The client now propagates `error.kind` and `error.hint` onto the thrown error, `deviceFail` respects a typed `err.kind` (defaulting to `device`), and `timeout` maps to exit 2 in the envelope (`KIND_TO_CODE`) so callers branching on 2 keep their contract while agents can still distinguish "no response" from a hard device error. A call that arrives after `stop()` began is rejected up front with `'session daemon is shutting down'` without incrementing `in_flight`, so it can never block the drain. `mauto session status` now reports `in_flight` (the outstanding-call count — the double-execution window is visible) alongside `running` and `device`. A structural drift guard (`tests/unit/device/timeout-invariant.test.js`) pins `CLIENT_TIMEOUT > DAEMON_CALL_TIMEOUT` so the mismatch cannot silently return. The underlying mobile-mcp call is not cancellable and continues in the background after a timeout — acceptable, because the agent now gets a bounded, honest error instead of a dropped reply.
  Closes #149

- **A recycled pid can no longer wedge the daemon path for the lifetime of an unrelated process.** `cleanStale` decided staleness from `pidAlive` alone — `process.kill(pid, 0)` proves liveness, not identity — so a lock/pidfile left by a crashed daemon whose pid was later reused by an unrelated process looked "live" and was respected, blocking every spawn for that workspace for up to ~75s/verb (the spawn readiness window plus the client timeout) until the unrelated process died. `cleanStale` now routes through a new `pidIdentity(pid)` that classifies each pid as `'dead' | 'ours' | 'other' | 'unknown'` by checking the process command line (`ps -p <pid> -o command=` via an injectable `execFile` seam): a recycled pid (`'other'`) is cleaned, a genuinely-live daemon (`'ours'`) is respected, and an unclassifiable pid (`'unknown'`, e.g. a host without `ps`) is treated as `'ours'` — never clean when unsure, and an `execFile` failure can never crash the daemon. `pidAlive` stays exported for back-compat. Two adjacent lifecycle holes are closed in the same pass: `session-spawn` now attaches an `'error'` listener to the spawned child so a synchronous spawn failure (EMFILE/EACCES) bails the readiness poll immediately instead of waiting out the full 15s window (no `'exit'` short-circuit — a loser exiting ELOCKED is expected and the winner may still come up), and the daemon entrypoint now registers an `unhandledRejection` handler mirroring its `uncaughtException` guard so a rejected promise tears the daemon down instead of leaking the mobile-mcp child and stale files.
  Closes #150

## [0.23.0]

### ✨ Added

- **The `result` verbs can now record every fact the result schema can hold.** `ResultStore` has always accepted a step screenshot, an error message, typed observations, assertion verdicts, captured variables, run metadata and a summary — but no CLI verb passed any of them through, and `addAssertion` / `captureVariable` had no caller at all, so `assertion_results` was empty and `total_assertions` was `0` in every result file the tool has ever produced. Worse, the missing flags did not degrade gracefully: commander rejected the unknown option before the handler ran, so a `result add-step` invocation written the way the guides describe lost the whole step. `mauto result add-step` now takes `--screenshot`, `--error-message`, a repeatable `--observation <type>:<message>` (validated against `regression | flakiness | state_context`, rejected with `invalid_input` otherwise) and a repeatable `--capture <name>=<value>`; a new `mauto result add-assertion` verb records verdicts; and `mauto result finalize` accepts `--app-version`, `--device-model`, `--api-level`, `--environment` and — a seventh gap of the same class, found during review rather than in the issue's original six — `--summary`, since `summary` is a required schema field with a `finalize()` override that no flag reached. Observations land in the **typed run-level array**, not the legacy per-step string, which is now marked deprecated in the schema. `mauto assert` returns a ready-to-run `result add-assertion` command in its envelope `hint`, so the agent copies the verdict rather than retyping it. A new capability catalog (`src/result/capability-catalog.js`) binds every schema fact to the store method that writes it and the flag that supplies it, and a structural guard (`tests/lint/result-coverage.test.js`, registered in `lint:guides`) derives its assertions from that catalog — including a completeness check that every top-level `result_schema.json` property is either claimed by a capability or sits on an explicitly justified allowlist, which is what caught the `summary` gap. Capabilities whose write site is a bare scalar indistinguishable from a destructured parameter (`screenshot`, `error_message`, `metadata`, `summary`) are proven `behavioral` — by driving a real `ResultStore` against a tmpdir — rather than by a source substring, which the catalog reserves for write sites unique enough to trust (`writeCheck: 'substring'`). The execute guides (aware and agnostic) now name `add-assertion --message/--expected/--actual` and the failure-path `--error-message`/`--screenshot`. This is the `result`-verb counterpart to the action-catalog guard added for [#117](https://github.com/sh3lan93/mobile-automator/issues/117). Result schema stays at `2.0`; existing result files keep validating. ([#140](https://github.com/sh3lan93/mobile-automator/issues/140))

## [0.22.1]

### 🐛 Fixed

- **The `.claude/commands/` fallback is no longer weaker than the skill it stands in for.** Claude Code merged custom commands into skills and gives a same-named skill precedence, so the three `mobile-automator-<topic>.md` files `mauto init --agent claude` writes are never read on a host with skills support — while `claudeCommandBody()` looked like the live instruction surface and invited edits that would silently do nothing (an early `argument-hint` proposal during [#137](https://github.com/sh3lan93/mobile-automator/issues/137) would have been exactly that no-op). The files are still written, because they *do* win in two cases — a Claude Code predating skills, and any workspace whose last `mauto init` predates 0.21.0, when skill installation was added — but on those paths they were carrying a single directive against the skill's four (no `mauto memory show`, no screenshot-backed assertions, no exact-scenario adherence) and no `description` frontmatter, so a host derived a description by truncating the body and got the mechanism ("Run `mauto guide execute` and follow it…") instead of the authored "use when…" trigger. The body is now *derived* from the same two sources the skill renders from — `SKILL_META` for the description and `<topic>.invariants.md` for the directives, via a new exported `readInvariants()` seam — so the two surfaces cannot drift and the fallback always carries the full directive set. A drift guard in `tests/unit/init/adapters.test.js` asserts the derivation rather than a substring, which is what makes it hold as the skill grows. Same seven files are written; no change to `mauto guide`. ([#139](https://github.com/sh3lan93/mobile-automator/issues/139))

## [0.22.0]

### ✨ Added

- **Reuse a prebuilt app artifact instead of rebuilding.** The `generate` and `execute` pre-flight told the agent to "Build and install the app using `{{build_command}}`" with no alternative, so a scenario run rebuilt the app even when a usable artifact already existed — typically one a previous run had just produced. The pre-flight in all four guide bodies (`generate`/`execute` × aware/agnostic) now prefers an artifact the user names, installing it with `mauto install <path>` and skipping the build. Building remains the fallback in platform-aware mode — and when no artifact is named there, the agent now checks whether the app is already installed and, if so, says so and asks whether to rebuild before proceeding, instead of rebuilding silently on the chance a previous run just built it; platform-agnostic mode (which never builds) now installs a supplied artifact instead of halting to ask the user to do it by hand. When the install fails because a different build is already on the device, the agent uninstalls, retries, and reports that app data was wiped. A new lint guard (`tests/lint/guide-artifact-reuse.test.js`, registered in `lint:guides`) asserts every emitted pre-flight offers the install branch and that the old unconditional phrasing cannot return. No new verb and no config key — `mauto install` and its `mauto bootstrap` entry already shipped in 0.21.0. ([#137](https://github.com/sh3lan93/mobile-automator/issues/137))

## [0.21.1]

### 🐛 Fixed

- **Workspace config values are now typed.** `mauto config set environments "a,b"` stored the literal string `"a,b"` instead of a list, because `config set` had no idea what shape any key held — it opportunistically `JSON.parse`d and fell back to the raw string, while the setup guide told the agent to pass a comma-separated value. The same defect hit `protected_directories` and `business_critical_paths`, and the same untyped handler retyped scalars (`config set project_name 12345` stored a number). A new `src/schemas/config_schema.json` declares the type of every known key; `config set` now coerces the raw argument to the declared type (comma-separated *or* JSON array → list; string keys stay strings) and validates it per-key before writing, returning a `hint` pointing at the new `mauto schema config` verb on a violation. Configs written by earlier versions are healed on read and rewritten in healed form by the next write. Unknown keys stay writable — the schema types keys, it does not gate them. A structural guard (`tests/lint/config-schema.test.js`) holds the schema, the placeholder table, the scaffold skeleton, the shipped fixtures, and the setup guide prose in agreement. ([#136](https://github.com/sh3lan93/mobile-automator/issues/136))

### ✨ Added

- `mauto schema config` prints the workspace config schema, so an agent can pull the config contract the same way it pulls `mauto schema scenario`. ([#136](https://github.com/sh3lan93/mobile-automator/issues/136))

## [0.21.0]

### ♻️ Changed

- **Device-session connection layer deepened behind one seam (no behavior change).** The daemon-vs-oneshot decision used to be threaded through `resolveDeviceConnection`'s six-concern body (four injected seams + a real handle-file write per test) and re-wired a second time by `cli.js`'s session handlers. It now has one owner: a new `src/device/connection.js` exposes a single verb-facing `acquireConnection({device, projectRoot}) -> {bridge, close}` that hides the decision entirely (the resolver's `source` stays private), plus `isSessionAlive`/`startSession`/`endSession` that `handleSessionStart/Status/End` delegate to. The pure `chooseConnectionStrategy({alive, handleDevice, requestedDevice, autostart}) -> 'daemon'|'oneshot'|'spawn-then-daemon'` is split out of the effectful resolver so the branching is tested value-in/value-out (no `tmpRoot`/`writeHandle`/fakes). `cli.js`'s `realDeviceBridge` is now a thin alias to `acquireConnection`, and the duplicated inline `try/finally` in the `elements`/`screenshot` actions collapses into `withBridge`. `session-protocol.js`'s four pass-through codecs fold into a single `FrameParser.encode()`. End-to-end request reading drops from ~7 session modules to ~3 (cli → connection → bridge). ([#123](https://github.com/sh3lan93/mobile-automator/issues/123), Refs [#116](https://github.com/sh3lan93/mobile-automator/issues/116))

### ✨ Added

- `mauto memory show` and auto-harvested per-scenario run-history: `result finalize` now rolls typed observations into `mobile-automator/memory/run-history.md` (bounded rolling aggregate, advisory-locked). Slice 1 of the memory feature.
- `mauto memory add`/`memory forget` for agent-authored app-knowledge & preferences
  (`[asserted]`, exact-match de-dupe, lock-guarded), plus a "when to remember"
  instruction in the `execute`/`generate` guides. Slice 2 completes the memory feature.
- **Faithful verbs for seven device actions the schema already advertised.** New one-shot verbs — `mauto long-press`, `mauto double-tap`, `mauto launch <appId>`, `mauto install <path>`, `mauto uninstall <appId>`, `mauto open-url <url>`, `mauto orientation <portrait|landscape>` — wire scenario actions that the execute guide previously mapped to a non-existent "`mauto tap` long-press variant" or hand-waved onto `mauto press`. The mobile-mcp primitives existed (`mobile_long_press_on_screen_at_coordinates`, `mobile_double_tap_on_screen`, `mobile_launch_app`, `mobile_install_app`, `mobile_uninstall_app`, `mobile_open_url`, `mobile_set_orientation`) but were never surfaced through `DeviceBridge`. A new `src/device/action-catalog.js` is the single source of truth binding each schema action to its execution contract (`verb` / `semantic` / `composed` / `unsupported`). The new verbs are listed in `mauto bootstrap` and mapped in both guide modes (aware + agnostic), enforced by the coverage guard. ([#117](https://github.com/sh3lan93/mobile-automator/issues/117), Refs [#116](https://github.com/sh3lan93/mobile-automator/issues/116))
- **`mauto init` installs native Agent Skills.** `mauto init --agent <claude|cursor|gemini|copilot|agents|all>` now installs an Agent Skill (open standard: `SKILL.md` + `name`/`description` frontmatter) per workflow into each host's skills directory (`.claude/skills/`, `.cursor/skills/`, `.gemini/skills/`, `.github/skills/`, `.agents/skills/`). Skills are always discovered by the host and, on activation, inline the non-negotiable QA disciplines (follow scenario exactly, device only via `mauto` verbs, screenshot-backed assertions) while deferring the full mode-aware workflow to `mauto guide <topic>`. Restores guaranteed behavior-forcing without context bloat (progressive disclosure). The existing thin slash-commands/rules and MCP-server entry are still written for claude/cursor. (Refs [#69](https://github.com/sh3lan93/mobile-automator/issues/69))

### 🐛 Fixed

- **Session daemon transport honesty + lifecycle hardening.** The persistent device session daemon reintroduced the "claims success, didn't happen" failure class at the transport layer (cf. #112/#113/#117), untested. Three clusters are fixed: **(A1) honest replies** — `reply()` no longer swallows write failures in `catch(_){}`; a successful device action whose reply cannot be delivered (peer gone / destroyed socket) is now recorded as undeliverable (surfaced on the daemon's `undeliverable` list / stderr) instead of hanging the client to a 30s false-failure that triggers a double tap; a non-serializable result becomes an explicit `ok:false` frame rather than a dropped reply; and `socket.write` backpressure is awaited via `'drain'` so large payloads (screenshots, element trees) actually reach the client. **(A2) drain-before-idle-stop** — an `inFlight` counter is incremented before `await call` and decremented after the reply; the idle timer is cleared while a frame is handled and re-armed only after the reply, and `stop()` defers teardown while a call is in flight, so the idle reaper can no longer destroy a socket mid-action. **(C2/B2) spawn lock** — `startDaemon` now acquires an exclusive per-workspace lock (`fs.openSync(lockPath,'wx')`) before building the mobile-mcp connection, so the loser of a double-spawn exits before it ever spawns a child; `listen` failure runs the connection's `close()` via try/finally (no orphaned mobile-mcp child) and releases the lock; `cleanStale` now reaps a stale lock; the daemon bin's `uncaughtException`/`exit` cleanup is **ownership-gated** — it removes the lock/socket/pid/handle only when the lock file still holds this process's pid, so a spawn-race loser (whose `startDaemon` threw `ELOCKED`) can never delete the winner's files (which would have unlinked the live socket path and freed the lock, re-spawning a second mobile-mcp child — the very orphan the lock prevents). New integration-style tests drive a stub mobile-mcp `createCall` (per-call delay / forced error / circular result / hang-on-init) through the real socket/idle/stop/lock paths, plus a bin-level test asserting the loser leaves the winner's files intact. ([#122](https://github.com/sh3lan93/mobile-automator/issues/122), Refs [#116](https://github.com/sh3lan93/mobile-automator/issues/116))
- **Uncaught exceptions can no longer escape the JSON envelope contract.** Several paths threw a raw `SyntaxError`/`Error` stack to stderr with a generic exit 1 — a corrupt `mobile-automator/config.json` (crashing `guide`/`config`/`setup`), a malformed existing `.mcp.json` on `mauto init`, a non-writable workspace during `setup`, and — worst — a device verb whose mobile-mcp connection rejected, which surfaced as exit 1 instead of the `device` exit 2 an agent maps on. The `{ok,error,...}` envelope is the one contract every host agent depends on, so a stack trace on stderr with empty stdout silently broke it. A single `withEnvelope(...)` boundary now wraps every verb's action: any escaped throw/rejection is classified by `toEnvelope(err)` (`SyntaxError` → `invalid_input` exit 3; fs `EACCES`/`ENOENT`/`EROFS`/`ENOSPC`/`EPERM` → `environment` exit 5 with a filesystem hint — a first-class kind distinct from a genuine `internal` CLI fault, so an agent/CI can tell "make the workspace writable and retry" from "file a bug"; anything else → `internal`) and emitted as exactly one envelope. An unexpected `internal` error additionally writes its stack to **stderr** so a crash stays debuggable without polluting the stdout envelope contract. The device-bridge connect is now made *inside* the try so connect failures land as `device` (exit 2), and a top-level guard in `run()` plus an `unhandledRejection` handler in `bin/mauto.js` cover the `ScenarioValidator` construction that throws before any action runs. ([#120](https://github.com/sh3lan93/mobile-automator/issues/120), Refs [#116](https://github.com/sh3lan93/mobile-automator/issues/116))
- **`mauto init --agent all` is now atomic-honest instead of failing silently mid-batch.** Previously the `all` path mapped over the five hosts with no `try/catch` and hardcoded an `ok` envelope — the first adapter to throw (permission-denied on `.github/`/`.cursor/`, a corrupt pre-existing `.mcp.json`, read-only FS) aborted the batch and escaped as a bare stack trace, leaving the project half-configured with no error envelope and no signal an agent could parse. `init --agent all` now continues on error and returns ONE envelope carrying a per-agent `data.agents[]` ok/failed map: `ok` only when all five succeed, otherwise a `partial_failure` fail-envelope (exit 1) that names which hosts failed and why (`data.agents[].error`). It leans on the existing content-addressed idempotency, so re-running converges the failed hosts without clobbering the succeeded ones. `mergeMcpConfig` now raises a typed `corrupt_mcp_config` error (never a bare `SyntaxError`) on a malformed existing host config and never overwrites the user's file. Single-agent `init` likewise turns a throwing apply into a fail envelope rather than a stack trace. Adapter failures are now classified honestly: an OS errno (`EACCES`, `ENOSPC`, …) keeps its code with a filesystem hint, a malformed host config reports `corrupt_mcp_config`, and any other throw (a code bug, a leaked-placeholder guard) is reported as `internal` — never mislabeled `io_error` with a "fix your filesystem" hint that would misdirect diagnosis. ([#121](https://github.com/sh3lan93/mobile-automator/issues/121), Refs [#116](https://github.com/sh3lan93/mobile-automator/issues/116))
- **`long_press`/`double_tap` no longer silently degrade to a plain tap.** The execute guide mapped them to a `mauto tap` "variant" that never existed, so an agent replaying a `long_press` step issued a single click and the step reported `passed` — the same "claims success, didn't happen" failure class as #112/#113. The guide now points each schema action at its real verb (or, for `clear_app_data`/`enable_wifi`/`disable_wifi` which mobile-mcp 0.0.55 cannot perform, marks them not-mechanically-executable so the agent reports them honestly instead of improvising). A new structural guard (`tests/lint/action-coverage.test.js`) fails the build if any `scenario_schema.json` action lacks a faithful execution path — and now also if a verb is missing from `mauto bootstrap` or a precondition action is documented in only one guide mode — so the schema, the verb surface, the bootstrap map, and both guides can no longer drift apart. ([#117](https://github.com/sh3lan93/mobile-automator/issues/117), Refs [#116](https://github.com/sh3lan93/mobile-automator/issues/116))
- **`mauto tap`/`long-press`/`double-tap` reject an empty coordinate part.** `--at 10,` previously resolved to `(10, 0)` with no error because `Number('')` is `0`; coordinate parsing now rejects empty/whitespace-only parts as `invalid_input`. ([#117](https://github.com/sh3lan93/mobile-automator/issues/117))
- **The result store is now crash-atomic and never silently discards a corrupt result.** For a QA tool the result file is the product, yet `src/result/store.js` wrote it with a plain `writeFileSync` (an `O_TRUNC` that zeroes the file before streaming) and, on read, swallowed any parse error as an empty run — so a crash mid-write left truncated JSON and the *next* `result add-step` clobbered every prior step with no warning. Both write sites (`_persistInProgress`, `finalize`) now write to a hidden same-dir temp file, `fsync`, then atomic `rename(2)` (a reader or crash sees old-complete or new-complete, never torn; the temp file is cleaned up on failure). `_load` now distinguishes `ENOENT` (legitimate first step → empty accumulator) from a `JSON.parse` failure (a crash artifact): the corrupt bytes are preserved as a `<runId>.json.corrupt.<ts>` sidecar and a structured warning is recorded on the store, which `mauto result add-step`/`finalize` thread into the success envelope's `hint` (the `ok()` envelope now carries an optional `hint`) — a single contract channel, so the model layer stays print-free and unit-testable (no `console` side-effect). The finalized object shape is unchanged, so files still validate against `result_schema.json`. ([#119](https://github.com/sh3lan93/mobile-automator/issues/119), Refs [#116](https://github.com/sh3lan93/mobile-automator/issues/116))
- `mauto press` now resolves the four platform-agnostic semantic actions (`press_back`, `dismiss_keyboard`, `grant_permission`, `deny_permission`) to per-platform mechanics on Android and iOS instead of forwarding the raw token to mobile-mcp (which only understands hardware buttons). Android `press_back`/`dismiss_keyboard` map to the `BACK` button; iOS `press_back` is the left-edge interactive-pop swipe; permission actions tap the system dialog's Allow/Deny affordance by label; iOS keyboard dismissal taps a return key or swipes down. An action that cannot be resolved on the connected platform now fails honestly (`ok:false`, `device` error) rather than as a silent no-op or a bogus button press. Hardware buttons (`BACK`/`HOME`/`ENTER`) keep their existing passthrough. (#112)

### 📝 Docs

- Migrated the shipping docs off the removed Gemini-*extension* model to the host-agnostic `mauto` CLI: rewrote `TROUBLESHOOTING.md`, `CONTRIBUTING.md`, the `ROADMAP.md` "Last updated"/extension-era items, and the entire `docs/` MkDocs site (getting-started, index, faq, guides, concepts, reference/references). Replaced colon slash-commands (`/mobile-automator:*` → hyphen `/mobile-automator-*` or `mauto guide <topic>`), `gemini extensions install/link` → `npm install && npm link` + `mauto init/setup`, dropped the removed `setup_state.json` and `.gemini/skills/.archive` restore flow, added the missing `mauto devices` checkpoint to the quick-start, and reframed the `mobile_*` reference pages as the internal mobile-mcp engine that `mauto` verbs wrap. A new guard test (`tests/lint/docs-no-stale-extension.test.js`) fails on those stale tokens in shipping docs (excluding the changelog and `docs/plans/**`) so the docs can't drift back. ([#124](https://github.com/sh3lan93/mobile-automator/issues/124), Refs [#116](https://github.com/sh3lan93/mobile-automator/issues/116))

## [0.20.1]

### 🐛 Fixed

- Device verbs no longer report `ok:true` for failed mobile-mcp calls. `parseToolResult` now surfaces both MCP `isError` results and mobile-mcp's `ActionableError` failures (returned as plain text with the sentinel `". Please fix the issue and try again."` and no `isError` flag), so `tap`/`press`/`screenshot`/etc. fail honestly instead of laundering the error into a success envelope. This also fixes `mauto screenshot` silently writing no file (`bridge.js` passed `path` instead of mobile-mcp's `saveTo`).
- Content assertions (`text_contains`, `element_text`, `text_not_empty`, `pattern_match`, `value_matches_variable`, `text_changed`) now read an element's `accessibility_label` when it has no text node. Previously they inspected only `text`, so they silently failed on label-driven UIs (Flutter/RN and other agnostic targets) where visible content is exposed through accessibility labels.

## [0.20.0]

### Removed
- The recorder feature in full: `mauto record` / `mauto record-bundle` verbs, the `record` guide topic, the `tools/recorder/` sidecar + web GUI, the C3 instrumentation-protocol spec, and the `ws`/`pngjs` dependencies. The host-agnostic `mauto` CLI and all other verbs are unchanged. Recover the recorder from history at tag `v0.19.2` if needed.

## [0.19.2]

### 🐛 Fixed

- Recorder GUI WebSocket now connects to the served port instead of a hardcoded one ([#109](https://github.com/sh3lan93/mobile-automator/issues/109)).

## [0.19.1]

### 🐛 Fixed

- Recorder shares one clock between tap sources and the hierarchy poller so taps resolve to the right target ([#108](https://github.com/sh3lan93/mobile-automator/issues/108), [#107](https://github.com/sh3lan93/mobile-automator/issues/107)).

## [0.19.0]

### 🐛 Fixed

- Device layer matches the mobile-mcp 0.0.55 element/coordinate contract (single-device auto-resolve, coordinate→bounds mapping) ([#106](https://github.com/sh3lan93/mobile-automator/issues/106)).

## [0.18.0]

### ✨ Added

- Recorder live interaction capture (Android `getevent` + iOS screenshot polling) ([#104](https://github.com/sh3lan93/mobile-automator/issues/104)).

## [0.17.0]

> **The interactive recorder graduates to generally available.** `mauto record` now ships in the npm package and is no longer flagged experimental. (Refs [#21](https://github.com/sh3lan93/mobile-automator/issues/21))

### ✨ Added

- **Recorder ships in the npm package** (Refs [#21](https://github.com/sh3lan93/mobile-automator/issues/21)). `package.json`'s `files` allowlist now includes `tools/recorder/src/` and `tools/recorder/web/`, so `mauto record` works on a plain `npm i -g mobile-automator` install — previously the sidecar was excluded from the published tarball and the command only ran in linked local checkouts. A new packaging guard test (`tests/unit/packaging.test.js`) asserts the sidecar entrypoint and GUI assets are present in `npm pack` output, preventing silent re-exclusion.

### 🐛 Fixed

- **Recorder GUI now auto-opens (no more silent hang)** ([#65](https://github.com/sh3lan93/mobile-automator/issues/65), Refs [#21](https://github.com/sh3lan93/mobile-automator/issues/21)). `mauto record <name>` previously started the HTTP+WebSocket sidecar and the mobile-mcp device connection but never opened the browser GUI nor printed its URL, so the terminal hung on `mobile-mcp server running on stdio` waiting for a WebSocket message that could never arrive. `startLiveCapture` now prints `🌐 Recorder GUI: http://127.0.0.1:<port>/` to **stderr** (stdout stays reserved for the JSON envelope) and auto-launches the host's default browser (`open`/`xdg-open`/`start`) immediately after the HTTP server binds. The URL is always printed as a fallback when auto-open fails silently; `--no-gui` skips the launch for CI/headless runs. New `tools/recorder/src/server/browser-opener.js` helper, dependency-injected for tests.

### 🔧 Changed

- **Recorder is no longer experimental/gated.** The `MOBILE_AUTOMATOR_RECORDER=1` opt-in (already a no-op in the CLI — it was never enforced in code) and the "experimental" framing are removed from `README.md`, `tools/recorder/README.md`, and `CLAUDE.md`.

## [0.16.1]

### 🐛 Fixed

- Recorder GUI connects to the CLI-served port on auto-open ([#101](https://github.com/sh3lan93/mobile-automator/issues/101)).

## [0.16.0]

### ✨ Added

- **Device discovery + persisted selection** ([#92](https://github.com/sh3lan93/mobile-automator/issues/92), Refs [#69](https://github.com/sh3lan93/mobile-automator/issues/69)). `mauto devices` lists connected devices/simulators (`id`, `name`, `platform`, `state` only — no OS-specific identifiers) in the standard JSON envelope; an empty list is a valid `ok([])` result. `mauto devices use <id>` persists a selection (validated against the live device list) so subsequent one-shot verbs reuse it without re-passing `--device`; `mauto devices clear` removes it. The selection is stored alongside #91's session layout at `mobile-automator/.session/selection.json` (separate from `config.json` and the daemon handle). Precedence is explicit `--device` flag > persisted selection > none — `--device` is always a per-call override and never writes the store, and a verb with no selection still passes `null` so mobile-mcp auto-selects a single device. Selecting against zero or an unknown device fails clearly (`error.kind = "device"`, exit 2) with a `hint` listing the available ids.

## [0.15.0]

### ✨ Added

- **Persistent device session daemon** ([#91](https://github.com/sh3lan93/mobile-automator/issues/91), Refs [#69](https://github.com/sh3lan93/mobile-automator/issues/69)). The first device verb (or an explicit `mauto session start`) now spawns a long-lived background daemon that builds the mobile-mcp connection **once** and serves every subsequent one-shot verb over a per-workspace Unix domain socket (`mobile-automator/.session/`). A 40-step scenario pays the spawn+handshake tax once instead of 40 times. Verbs stay one-shot from the shell's perspective — this is not the rejected interactive `run` co-routine. `mauto session start|status|end` give explicit lifecycle control; an idle timeout reaps an abandoned daemon and stale socket/pidfiles are detected and replaced on next start. Graceful fallback: when no daemon is reachable, verbs fall back to today's one-shot spawn. **Device-pin safety:** if the daemon is pinned to device A and a verb passes `--device B`, the verb bypasses the daemon and uses a one-shot connection rather than silently driving the wrong device.

## [0.14.0]

> **The `mobile-automator` package is now npm-publishable and CI-reproducible.** ([#93](https://github.com/sh3lan93/mobile-automator/issues/93), Refs [#69](https://github.com/sh3lan93/mobile-automator/issues/69))

### ✨ Added

- **Publish metadata + `files` whitelist** — `package.json` is un-privatized (`"private": true` removed) and gains `description`, `repository`, `homepage`, `bugs`, `license` (`Apache-2.0`), and `author`. A `"files": ["bin/", "src/"]` allowlist ships only the runtime surface (no `tests/`, `sample-app/`, `tools/`, or `docs/`).
- **`mobile-automator` bin alias** — both `mauto` and `mobile-automator` now map to `bin/mauto.js`, so the documented `npx mobile-automator <verb>` resolves.

### ♻️ Changed

- **mobile-mcp is bundled, not fetched at runtime** — `@mobilenext/mobile-mcp` is now a declared dependency pinned at `0.0.55` (matching the CI smoke runner). `src/device/mobile-mcp-client.js` resolves the installed server entry via `require.resolve('@mobilenext/mobile-mcp/package.json')` and spawns it with the current Node binary instead of `npx -y @mobilenext/mobile-mcp@latest`. This removes the per-cold-start network version check and makes clean installs / CI runs reproducible.
- **Node ≥ 18 clarified** — README prerequisite corrected from "v16+" to "v18+", matching `engines.node`.

## [0.12.1] — 2026-05-23

### 🐛 Fixed

- **Recorder GUI — unified tap target quote-wrap contract** ([#40](https://github.com/sh3lan93/mobile-automator/issues/40)). The legacy generic branch in `renderStepRow` and its sibling `applyStepRenamed` now wrap `step.target` in literal `"` characters at render time, matching the `long_press` / `double_tap` branches (slice [#24](https://github.com/sh3lan93/mobile-automator/issues/24)) and the `type` branch (slice [#35](https://github.com/sh3lan93/mobile-automator/issues/35)). Aligns the user-visible rendering with what the live lifecycle producer at `tools/recorder/src/lifecycle.js` actually sends (unquoted `display_name`). Pre-baked-quote test fixtures across the recorder unit suite were corrected accordingly. Bug was latent — the live `step-added` broadcast producer is not yet wired in production.

## [0.12.0] — 2026-05-23

> **Soft-launch graduation of `/mobile-automator:record`** — the cross-platform interactive scenario recorder designed in [PRD #21](https://github.com/sh3lan93/mobile-automator/issues/21) and built across 13 slices. The recorder is feature-complete and stays gated behind `MOBILE_AUTOMATOR_RECORDER=1` so it can collect real-world mileage before the env-var gate is removed in a future release. With the gate off, behaviour is identical to v0.11.0.

### ✨ Added

- **`/mobile-automator:record <scenario_name>` command** — opt-in cross-platform recorder. Pre-flights config / device / app install / environment, then opens a browser GUI hosted by a local Node sidecar. Steps materialise in the GUI as the user interacts with the device; on **Save & Generate**, a recorder skill ingests the artifact bundle and emits a schema-conformant scenario JSON to `mobile-automator/scenarios/<scenario_id>.json`, identical in shape to scenarios produced by `/mobile-automator:generate`. ([PRD #21](https://github.com/sh3lan93/mobile-automator/issues/21))
- **Capture pipeline** — single-touch gestures (`tap`, `long_press` ≥ 500 ms, `double_tap` within 300 ms at same coords, `swipe` with direction), `type` events (keyboard coalescing per focused field — Enter / focus-out / 1500 ms silence / session-end flushes), Android hardware keys (`BACK`, `HOME`, `VOLUMEUP`, `VOLUMEDOWN`, `POWER`) via `adb shell getevent -lt`, and iOS Simulator parity (`xcrun simctl` screenshots, "Show Single Touches" indicator detection, `XCUIElementType*` element resolution). ([#22](https://github.com/sh3lan93/mobile-automator/issues/22), [#35](https://github.com/sh3lan93/mobile-automator/issues/35), [#24](https://github.com/sh3lan93/mobile-automator/issues/24), [#25](https://github.com/sh3lan93/mobile-automator/issues/25), [#26](https://github.com/sh3lan93/mobile-automator/issues/26))
- **Assertion modal + AI classification at Save** — **Add Assertion** button in the GUI header opens a modal with a fresh device screenshot; the user describes the assertion in natural language and the AI applies a two-pass classifier at Save to convert NL → schema-typed assertion (any of the 27 types). Visual-state assertions carry a `reference_screenshot` path. Assertions are anchored to the most-recent step at click time. ([#27](https://github.com/sh3lan93/mobile-automator/issues/27))
- **Edit affordances** — per-step `⋯` menu offering type-filtered actions: **Rename** (any step, regenerates `step_id` slug), **Delete** (with confirm + 3-option re-anchor/cascade/cancel for anchored assertions), **Edit value** (`type` rows only — for typo fixes or `${env.VAR}` substitution), **Edit text** (assertion rows only — refine NL before classification). Reorder, insert, and arbitrary action-type change are deliberately not surfaced. ([#28](https://github.com/sh3lan93/mobile-automator/issues/28))
- **Agnostic-mode semantic action detection** — in `platform-agnostic` projects, the recorder auto-detects `press_back` (Android BACK key release or iOS left-edge right-swipe), `grant_permission` and `deny_permission` (taps on system permission dialogs, identified by Android `permissioncontroller`/`systemui` resource-ids or iOS `_UIAlertController` with exact label match against [`templates/references/platform-resolutions.md`](templates/references/platform-resolutions.md)). The fourth semantic action, `dismiss_keyboard`, is manual-only via a *Mark as dismiss_keyboard* item in the tap-row `⋯` menu. New `templates/mobile-automator-recorder/agnostic/SKILL.md` ships with the 6 agnostic placeholders and schema v2.1 conformance. ([#29](https://github.com/sh3lan93/mobile-automator/issues/29))
- **Sensitive-input caution markers + Save-time confirmation** — `type` events on Android `inputType=textPassword` / iOS `XCUIElementTypeSecureTextField` / `secureTextEntry: true` are flagged with `sensitive: true`. The GUI bullet-masks the value, renders a `⚠` caution marker, and at Save prompts inline if any flagged step still holds its captured literal. `${env.VAR}` substitution is a user-owned runtime convention enforced by the executor. `--allow-sensitive-input` suppresses the markers and Save-time prompt for projects with intentionally-hardcoded fixture credentials (bullet-mask still applies). ([#30](https://github.com/sh3lan93/mobile-automator/issues/30))
- **Failure modes** — three independent watchdogs wired through a single policy orchestrator:
  - **Device disconnect** — `DeviceWatchdog` trips after 3 capture failures within a 5 s rolling window; broadcasts a non-dismissible banner, cleans up, exits **code 2**.
  - **App crash** — `CrashWatchdog` polls `mobile_get_crash` every 5 s; dual-writes the crash log to `<artifacts>/crashes/<ts>.log` (in-bundle, included in save-partial) and `mobile-automator/crash-logs/<scenario_id>-<ts>.log` (persistent, survives discard). A sticky modal offers **Relaunch + resume**, **Save partial**, or **Discard**.
  - **Browser disconnect** — existing 60 s reconnect window; timeout falls through to cancel (exit **130**) with full cleanup. ([#31](https://github.com/sh3lan93/mobile-automator/issues/31))
- **`--overwrite` and `--verify` flags** — `--overwrite` is required when re-recording an existing scenario; on successful Save the prior `mobile-automator/screenshots/<id>/` is moved to `.archive/<id>-<timestamp>/`. `--verify` is opt-in (off by default — non-idempotent flows must not auto-replay); on successful Save, the executor skill replays the just-written scenario against the same device. Verify failure preserves the scenario JSON and never rolls back the Save. ([#32](https://github.com/sh3lan93/mobile-automator/issues/32))
- **C3 protocol v1.0** — TCP-over-loopback contract for future v1.1 instrumentation SDKs (iOS Swift Package, Android AAR). Spec at [`templates/references/c3-protocol.md`](templates/references/c3-protocol.md) covers transport, port-file + env-var discovery (`recorder-c3.port`, `MOBILE_AUTOMATOR_RECORDER_C3_PORT`), the versioned handshake, the six core event kinds (`tap`, `swipe`, `type`, `key`, `lifecycle`, `error`), the sidecar-to-SDK command vocabulary, and additive-fields versioning rules. Reference listener at `tools/recorder/src/c3/tcp-listener.js`. `--mode=c3` waits 10 s for an SDK to connect, then offers a Mode B fallback prompt to the operator. **No SDKs ship in v0.12.0** — they are v1.1 work. ([#33](https://github.com/sh3lan93/mobile-automator/issues/33))
- **System dependency: `ffmpeg`** — pre-flighted by `commands/mobile-automator/record.toml § 0.8` with platform-specific install hints on missing-binary halt, so the failure surfaces before the sidecar spawns.
- **README "Recording scenarios" section** — self-contained walkthrough covering opt-in, requirements, quick start, flags, capture vocabulary, mode awareness, sensitive-input handling, failure modes, verification, and current limitations. ([#34](https://github.com/sh3lan93/mobile-automator/issues/34))

### 🔄 Changed

- `scripts/install-skills.js` now installs the recorder skill in **both** `platform-aware` and `platform-agnostic` modes, alongside generator and executor.
- `commands/mobile-automator/setup.toml` § 6 install loop and § 7 scaffolding reflect the recorder skill in both modes.
- `.gitignore` adds `mobile-automator/.recorder/` (per-session working directory) and `mobile-automator/crash-logs/` (persistent crash logs that survive discard).

### 📝 Notes

- **Soft-launch gate.** The recorder remains hidden unless `MOBILE_AUTOMATOR_RECORDER=1` is set. The env-var gate stays so the feature can mature in real-world use before being removed in a future release; with the gate off, behaviour is identical to v0.11.0.
- **Not in v0.12.0** — iOS physical devices (out of scope per PRD); multi-touch gestures (pinch, rotate, two-finger pan — deferred); C3 instrumentation SDKs (protocol contract only — SDKs ship in v1.1); resume-from-draft after intentional cancel or browser-disconnect timeout (deliberately rejected during design); GUI localisation (English only).

---

## [0.11.0] — 2026-04-29

### ✨ Added

- **Platform-agnostic mode** — scenarios are portable across Android and iOS.
  - New `mode` field in `config.json` (`platform-aware` | `platform-agnostic`).
  - New § 1.5 (Mode Selection) in setup; new agnostic setup flow at §§ A.1–A.7.
  - New `templates/references/platform-resolutions.md` runtime contract for OS-shaped affordances.
  - Four new semantic actions: `press_back`, `dismiss_keyboard`, `grant_permission`, `deny_permission`.
  - Schema 2.1 (additive over 2.0 — adds `mode` metadata field and semantic actions; all 2.0 scenarios are valid 2.1 without changes).
  - Migration sub-flow (§ 1.6) with 3-phase atomicity, archive, and manual restore.

### 🔄 Changed

- `install-skills.js` is now mode-aware via `--mode=<mode>` flag.
- Aware-mode skill templates moved to `templates/mobile-automator-{role}/aware/`; agnostic templates added at `templates/mobile-automator-{role}/agnostic/`.

### 🔁 Migration

- v0.10 projects continue to work without change (config without `mode` field is treated as implicit `platform-aware`).
- To migrate to agnostic mode, re-run `/mobile-automator:setup` and select "Switch to platform-agnostic" at § 1.5.

---

## [0.10.0] - 2026-03-30

### 🗑️ Removed

- **Schema v1 Support** — Completely removed legacy v1 schema, migration tooling, and all dual-version routing logic.
  - Deleted `scenario_schema.json` (v1), `migrate.toml`, `MIGRATION.md`, `docs/guides/migrate.md`
  - Removed deprecation phase checks from `generate.toml` and `execute.toml`
  - Removed v1 detection/routing from executor skill template
  - Removed `/mobile-automator:migrate` command

### 🔄 Changed

- **Schema Rename** — Renamed `scenario_schema_v2.json` → `scenario_schema.json` and `docs/reference/schema-v2.md` → `docs/reference/schema.md` (the `_v2` suffix was vestigial with only one schema version).
- **Result Schema** — `step_id` and `assertion_id` are now `string`-only (previously accepted both `integer` and `string` for v1 backward compatibility). `schema_version` changed from `enum: ["1.0", "2.0"]` to `const: "2.0"`.
- **Install Script** — `scripts/install-skills.js` no longer copies the v1 schema to workspace.
- **CI Validation** — `.github/workflows/validate-schemas.js` updated to reference `scenario_schema.json` instead of `scenario_schema_v2.json`.
- **Documentation** — Removed all v1/v2/legacy/deprecated/migration references across 30+ files. All "v2" qualifiers dropped — the schema is now just "the schema".

### ✅ Kept

- `$schema_version: "2.0"` field preserved in all schemas for future extensibility.
- `CHANGELOG.md` historical entries unchanged — they are a record of what happened.

---

## [0.9.0] - 2026-03-28

### ✨ Added

- **Auto-Detect Business-Critical Paths** — Setup Section 5.0 now uses the `@codebase_investigator` subagent to automatically identify critical user paths from the codebase before asking the user.
  - Analyzes navigation graphs, route definitions, screen/Activity/Fragment definitions, feature modules, and README documentation
  - Presents detected paths for user confirmation (`yesno` prompt) instead of requiring manual input
  - Falls back to manual text input if auto-detection finds nothing or the user rejects the detected paths
  - Reduces setup friction — users confirm instead of typing

---

## [0.8.1] - 2026-03-28

### 🐛 Fixed

- **Deterministic Skill Installation** — Replaced the AI-mediated file copy/replace in setup Section 6.0 with a Node.js script (`scripts/install-skills.js`) that handles all template operations deterministically.
  - Fixes silent file corruption (truncation, missing sections, garbled schemas) during skill installation
  - Placeholder replacement now uses `split().join()` in Node.js instead of in-memory AI reproduction
  - Schema files copied byte-perfect with `fs.copyFileSync` instead of AI read/write
  - Runtime placeholders (`{{capture_to}}`, `{{variable_name}}`) in executor skill are now correctly preserved
  - Added `scenario_schema_v2.json` to template verification (was previously missing)
  - Verification now checks file existence, non-zero size, and setup-placeholder absence
  - Setup Section 6.0 reduced from ~100 lines to ~30 lines

---

## [0.8.0] - 2026-03-27

### 🗑️ Removed

- **TestRail Integration** — Removed all TestRail MCP server configuration, environment variables, and integration code.
  - Removed `testrail-mcp` MCP server from `gemini-extension.json`
  - Removed `TESTRAIL_API_KEY` and `TESTRAIL_DOMAIN` environment variables
  - Removed `testrail` metadata field from scenario schema
  - Removed TestRail result syncing from executor
  - Updated documentation to remove TestRail references
  - Migration path: scenarios without TestRail metadata continue to work unchanged

---

## [0.7.0] - 2026-03-27

### ✨ Added

- **Execute Command Enhancements** — Major UX and structural improvements to the `/mobile-automator:execute` command.
  - Added `--device="ID"` flag to bypass the interactive device selection menu and target a specific device.
  - Added `--all` flag to unconditionally execute all available scenarios without manual selection prompts.
  - Fully integrated structured `ask_user` tool calls natively for all interactive prompts (device selection, execution menu, confirmations).
  - Refined deprecation logic to evaluate v1 schema warnings early, *before* establishing device connections or running preconditions.

---

## [0.6.0] - 2026-03-20

### ✨ Added

- **Environment Persistence** — The generate command now remembers your last-used environment and skips the prompt on subsequent runs.
  - First run (or after clearing preferences): interactive prompt asks for environment and saves the selection to `mobile-automator/generate_preferences.json`
  - Subsequent runs: saved environment is used automatically with an `ℹ️` notice
  - `--set-environment="X"` — use environment X **and** save it as the new default preference
  - `--environment="X"` — one-time override, uses X for this run only without changing the saved preference
  - Stale preferences (environment removed from config) are detected automatically with a `⚠️` warning and the prompt re-appears
  - Single-environment projects skip the prompt entirely (always has, now also ignores flags cleanly)

---

## [0.5.0] - 2026-03-13

### ✨ Added

- **Test Report Command** — New `/mobile-automator:report` command generates aggregated test execution reports.
  - Supports multiple output formats: table (terminal), JSON, HTML
  - JUnit XML export for CI integration
  - Shows pass rate, failed scenarios, flaky steps, average duration
  - Filter by recent runs with `--last N` option (default: 10)

---

## [0.3.1] - 2026-02-25

### 🔄 Changed

- **Native Prompts** — Migrated user interaction prompts across `setup` and `generate` flows to use the structured `ask_user` tool natively.

---

## [0.3.0] - 2026-02-24


### ✨ Added

- **Tag-Based Filtering** — Organize, filter, and execute specific subsets of your scenarios using tags.
  - Added interactive prompt for tags during test scenario generation.
  - Added `--tag` filter to `execute` command with support for AND (`smoke,critical`), OR (`smoke|regression`), and NOT (`!flaky`).
  - Added new `/mobile-automator:list-tags` command to view the tag registry and counts across the testing suite.
  - Interactive execution menu now groups scenarios by primary tags when run without arguments.
  - Strict format validation enforcing lowercase alphanumeric + hyphens across schemas and commands.

---

## [0.2.0] - 2026-02-23

### ✨ Added

- **Expanded Assertion Types** — Supported assertion types increased to 27, organized with tiered categorization to handle simpler and complex edge cases.
- **New `!=` Comparison Operator** — Added support for the non-equality (`!=`) operator in assertion comparisons.
- **Two-Pass Semantic Intent Model** — Introduced a two-pass workflow for parsing test generation instructions to yield more reliable test assertions.
- **Schema Validation CI Workflow** — Added a GitHub Actions workflow that automatically validates the JSON syntax of all schemas, ensures Draft-07 conformance, and validates prototype scenarios against `scenario_schema_v2.json`.
- **TestRail Integration** — Bi-directional sync with TestRail test case management
  - Fetch test cases from TestRail via natural language step format with automation hints
  - Auto-convert TestRail steps to mobile-automator scenario JSON
  - Automatically sync test execution results back to TestRail
  - Includes device info, observations, and screenshots in TestRail test runs
- New MCP server: `testrail-mcp` for TestRail API access
- Optional `testrail` metadata field in scenario_schema_v2.json for 1:1 case mapping
- Environment variables `TESTRAIL_API_KEY` and `TESTRAIL_DOMAIN` for project-scoped configuration

### 🔄 Changed

- **Clarified Assertion Behaviors** — Improved documentation and instructions around `element_visible` and `list_item_count` assertions.
- **Skill Categories** — Reindexed skill categories within the project framework.
- **Documentation Updates** — Updated Gemini CLI installation source instructions in `CONTRIBUTING.md` and refreshed the "Last updated" date in `ROADMAP.md`.
- **Generator Skill Enhanced** — Detects and handles TestRail URLs for automated test case fetching
- **Executor Skill Enhanced** — Syncs results back to TestRail when scenario has testrail metadata

### ✅ Backward Compatible

- Manual test generation unchanged — TestRail is entirely optional
- Existing scenarios without `testrail` metadata work exactly as before

---

## [0.1.1] - 2026-02-18

### ✨ Added

#### Schema v2 — Smarter, More Reliable Test Scenarios
- **New default scenario format** — all generated scenarios now use schema v2 with `$schema_version: "2.0"` as a required root field
- **Named step IDs** — steps use descriptive snake_case string IDs (e.g., `"id": "tap_login"`) instead of integers; screenshots are now named accordingly (`step_tap_login.png` vs `step_3.png`)
- **Smart wait actions** — `wait_for_element`, `wait_for_element_gone`, `wait_for_loading_complete` replace fixed-time `wait`; eliminates the #1 source of test flakiness
- **Optional steps** — `optional: true` + `on_failure: "skip"` handles non-deterministic UI elements (promotional dialogs, permission prompts) without failing the test
- **Conditional steps** — `condition` field allows steps to be skipped based on device API level, runtime state, or whether a previous step was skipped
- **Retry logic** — `on_failure: "retry"` + `retry_policy: {max_attempts, backoff_ms}` distinguishes real bugs from transient failures
- **Variable capture** — `capture_value` action + `variables` root block captures dynamic values (prices, IDs, amounts) for cross-step verification
- **Nested conditional sub-flows** — `sub_steps` array expresses branching flows (e.g., "add address only if none exists") without requiring separate scenario files
- **New assertion types** — `pattern_match` (regex), `value_matches_variable`, `element_count` (with operators), `visual_state`, `text_changed` (state transitions like "Redeem" → "Redeemed")
- **Structured preconditions** — `preconditions` object with `app_state`, `device_actions`, `device_properties` enables automated pre-test setup
- **Clean metadata** — execution-time fields (`device_model`, `api_level`, `timestamp`) removed from scenario metadata; they belong in the result JSON

#### `/mobile-automator:migrate` — Interactive v1 → v2 Migration
- New command to upgrade existing v1 scenarios with a guided, human-supervised process
- Automatically converts: `$schema_version`, integer step IDs → named strings, assertion IDs, `after_step_id` references, metadata cleanup, preconditions restructuring
- Interactively handles ambiguous cases (fixed-time `wait` actions — asks what to wait *for*)
- Always creates a `.v1.bak` backup before writing any changes
- Lists what must be added manually after migration (intent the tool can't infer)

#### `MIGRATION.md` — Institutional Migration Guide
- 6 before/after JSON examples covering every major v1 → v2 change
- Clear breakdown of what the tool handles automatically vs. what requires human review
- Deprecation timeline table

#### `scenario_schema_v2.json` — Formal JSON Schema
- JSON Schema Draft-07 definition for all new scenario fields
- Validated against both prototype scenarios with zero errors

### 🔄 Changed

- **Generator SKILL.md** — updated to always produce v2 scenarios; expanded step translation guide (14 actions), pattern detection guide for smart waits, optional steps, conditional steps, retry, data capture, and nested sub-flows
- **Executor SKILL.md** — updated with full v2 execution path: condition evaluation, variable capture, sub-flow execution, retry logic, all 9 assertion types
- **Result schema** — extended additively with optional v2 fields (`schema_version`, `captured_variables`, step-level `retry_count`, `step_duration_ms`, `condition_evaluated`); `step_id` accepts both integer (v1) and string (v2)
- **`generate.toml`** — deprecation check when `--schema-version 1.0` flag is used
- **`execute.toml`** — deprecation check when a v1 scenario is detected
- **`setup.toml`** — copies `scenario_schema_v2.json` to workspace alongside v1 schema
- **`GEMINI.md`** — dual schema registry (v2 default + v1 legacy), expanded tool mapping table with all 14 action types
- **`README.md`** — updated schema section to describe v2, added `/mobile-automator:migrate` to commands table, updated project structure tree with named screenshot IDs and `scenario_schema_v2.json`
- **`CLAUDE.md`** — updated file structure, schema documentation, and namespace list to reflect all new files

### ⚠️ Deprecation Notice

Schema v1 is deprecated as of **2026-02-17**. The 12-month deprecation timeline:

| Phase | Period | Behavior |
|-------|--------|----------|
| Phase 1 | Now → 2026-08-17 | Non-blocking warning on v1 generate/execute |
| Phase 2 | 2026-08-17 → 2027-01-17 | New v1 generation blocked; execution requires acknowledgment |
| Phase 3 | 2027-01-17+ | Hard fail — v1 scenarios will not execute |

Migrate existing scenarios with `/mobile-automator:migrate <scenario_id>`. See [MIGRATION.md](MIGRATION.md) for the full guide.

---

## [0.1.0] - 2025-02-13

### 🎉 First Beta Release

Mobile Automator's first beta release brings **intelligent mobile QA automation** to Gemini CLI. This isn't just another testing tool—it's an AI-powered extension that learns your app's architecture and generates customized testing skills specifically for your project.

**Note:** This is a pre-1.0 release. Breaking changes may occur in future updates as we refine the extension based on user feedback.

---

### ✨ Core Features

#### Intelligent Project Analysis
- **7-Section Setup Workflow**: Comprehensive project analysis that goes beyond basic configuration
  - Platform detection for Android, iOS, Flutter, React Native, Kotlin Multiplatform, and Compose Multiplatform
  - Environment discovery (production, staging, development, custom flavors)
  - **Environment-specific package ID inference**: Detects `applicationIdSuffix` for Android flavors and bundle ID overrides for iOS configurations
    - Android: Constructs full package IDs per flavor/buildType (e.g., `com.app.demo.staging`)
    - iOS: Detects configuration-specific bundle IDs from `.xcconfig` files and scheme settings
    - Stores mappings: `android_packages: {"demoStaging": "com.app.demo.staging", ...}`
  - **Architecture pattern detection**: Automatically recognizes MVVM, Clean Architecture, BLoC, Redux, MVP, VIPER
  - **Business domain extraction**: Understands what your app does by analyzing README, manifests, and store listings
  - **Loading indicator detection**: Greps source code for your specific progress indicators and shimmer effects
  - **Resume capability**: Interrupted setup can be resumed from the last successful step

#### Automatic Skill Generation
- **Project-specific skills**: Generated skills are customized with 13 placeholders populated from your codebase
- **Zero-configuration deployment**: Skills automatically installed to `.gemini/skills/` with no manual steps
- **Smart template path resolution**: Automatically detects extension installation method
  - Local development (linked): Reads `.gemini-extension-install.json` to find source path
  - GitHub installation: Uses templates directly from extension directory
  - Works seamlessly with both `gemini extensions link` and `gemini extensions install`
- **Placeholder replacement**: Template variables like `{{project_name}}`, `{{architecture}}`, `{{loading_indicators}}` are automatically replaced with detected values
- **Schema distribution**: Test scenario and result schemas automatically copied to workspace
- **Mobile-MCP tools reference**: Self-contained tool mapping documentation (`mobile-mcp-tools.md`) distributed with skills for offline reference

#### Natural Language Test Generation
- **Multi-format input support**: Accepts numbered lists, arrow notation, or conversational descriptions
- **Real device execution**: Tests run on actual devices/emulators, not simulations
- **Screenshot evidence**: Captures reference screenshots at every checkpoint
- **Structured JSON output**: Generates formal test scenarios following a production-grade schema

#### Intelligent Test Execution
- **Automatic precondition handling**: Reads scenario preconditions and handles them intelligently
  - `fresh_install`/`app_uninstalled`: Automatically uninstalls, builds, and reinstalls without prompting
  - `app_not_previously_installed`: Clears all app data before fresh install
  - State preconditions (`user_logged_out`, `dark_mode_enabled`): Configured during test setup
  - No more manual setup steps or redundant questions
- **Environment-aware package selection**: Uses correct package ID based on scenario's environment
  - Reads `metadata.environment` from scenario
  - Selects appropriate package from `android_packages` or `ios_bundle_ids` mapping
  - Ensures tests run against the correct flavor/configuration
- **Flakiness detection**: Automatically detects and flags timing-related test failures
  - Retries once on suspected timing issues
  - Distinguishes real bugs from loading delays
  - Suggests test improvements
- **Regression spotting**: Notices visual changes beyond explicit assertions
  - Detects missing elements that were present in reference
  - Flags new elements that weren't there before
- **State-aware failure analysis**: Provides diagnostic context for failures
  - Dark mode vs light mode mismatches
  - Device differences (Pixel 6 vs Pixel 8)
  - Network state, keyboard visibility, orientation
- **Semantic visual testing**: Uses AI vision for screenshot comparison instead of brittle pixel-matching
  - Focuses on screen purpose and key elements
  - Tolerates minor rendering differences
  - Catches functional regressions while ignoring cosmetic changes

---

### 🏗️ Architecture

#### 3-Tier Command Delegation
- **Tier 1 - Extension Commands**: Pre-flight checks, device detection, validation
  - `/mobile-automator:setup` - One-time project analysis and skill installation
  - `/mobile-automator:generate` - Test scenario generation wrapper
  - `/mobile-automator:execute` - Test execution wrapper
- **Tier 2 - Workspace Skills**: Project-specific testing logic
  - `mobile-automator-generator` - Customized test recorder
  - `mobile-automator-executor` - Intelligent test runner
- **Tier 3 - Automation Engine**: Device control primitives via `mobile-mcp`
  - Platform-agnostic device automation
  - Real device/emulator support
  - Cross-platform compatibility

#### Wrapper Pattern
- Commands handle infrastructure (device connection, app installation)
- Skills contain domain logic (test recording, execution, validation)
- Clean separation of concerns enables maintainability and extensibility

---

### 📱 Platform Support

| Platform | Detection | Build Support | Device Automation |
|----------|-----------|---------------|-------------------|
| **Android Native** | ✅ Gradle patterns | `./gradlew assemble*` | ✅ Emulator + Real Device |
| **iOS Native** | ✅ Xcode patterns | `xcodebuild` | ✅ Simulator + Real Device |
| **Flutter** | ✅ `pubspec.yaml` | `flutter build` | ✅ All platforms |
| **React Native** | ✅ Metro bundler | `npx react-native run-*` | ✅ All platforms |
| **Kotlin Multiplatform** | ✅ KMP structure | Gradle + Xcode | ✅ Android + iOS |
| **Compose Multiplatform** | ✅ CMP structure | Gradle + Xcode | ✅ Android + iOS |

---

### 🎯 Commands

#### `/mobile-automator:setup`
One-time setup command that analyzes your project and installs customized testing skills.

**What it does:**
- Detects platform and build configuration
- Discovers environments (staging, production, etc.)
- Infers app package IDs from build files
- Analyzes architecture patterns and business domain
- Detects project-specific loading indicators
- Generates customized skills with populated placeholders
- Creates test artifact directory structure

**Features:**
- Interactive with smart defaults
- Resume capability if interrupted
- State management for reliability

#### `/mobile-automator:generate`
Generates test scenarios from natural language descriptions.

**Features:**
- Device/emulator auto-detection
- Multi-device selection support
- Optional build and install
- Natural language step parsing (numbered lists, arrows, conversational)
- Real-time device execution with recording
- Reference screenshot capture
- JSON scenario file generation
- Schema validation

#### `/mobile-automator:execute`
Executes saved test scenarios and produces intelligent reports.

**Features:**
- Single scenario, multiple scenarios, or tag-based execution
- Run all scenarios via interactive option (select "All scenarios" when prompted)
- Device/emulator auto-detection
- Step-by-step replay with validation
- Screenshot comparison
- Flakiness detection with automatic retry
- Regression spotting
- State-aware failure diagnostics
- Detailed JSON result reports

---

### 📋 Test Scenario Schema

Production-grade JSON schema for test scenarios:

**Key Fields:**
- `scenario_id` - Unique snake_case identifier
- `platform` - android | ios | cross-platform
- `app_package` - Bundle ID or package name
- `preconditions` - Required state before execution (e.g., "fresh_install")
- `tags` - Categorization (e.g., "smoke", "regression", "authentication")
- `metadata` - Version, device, API level, environment, timestamp
- `steps` - Action sequence with checkpoints and expected states
- `assertions` - Validation rules with types and tolerances

**Supported Actions:**
- `launch_app`, `tap`, `type`, `swipe`, `press_button`, `wait`, `open_url`

**Supported Assertions:**
- `screenshot_match` - Semantic visual comparison
- `element_exists` - UI element presence validation
- `element_text` - Text content verification
- `element_not_exists` - UI element absence validation

---

### 📊 Test Result Schema

Comprehensive result schema with diagnostic data:

**Key Fields:**
- `run_id` - Unique run identifier (format: `run_YYYYMMDD_HHMMSS`)
- `status` - passed | failed | error
- `steps_executed` - Per-step results with retry flags
- `assertion_results` - Detailed pass/fail with context
- `observations` - Structured diagnostic insights
- `duration_seconds` - Execution time
- `metadata` - Execution environment details

**Observation Types:**
- `regression` - Visual changes beyond explicit assertions
- `flakiness` - Timing-related failures with retry behavior
- `state_context` - Device/environment context for failures

---

### 🧠 Advanced Features

#### Architecture Pattern Detection
Automatically recognizes common mobile architecture patterns:
- **MVVM** - ViewModel, LiveData patterns
- **Clean Architecture** - Domain, data, presentation layers
- **BLoC** - Business Logic Component (Flutter)
- **Redux/MVI** - Reducer, store, actions
- **MVP/VIPER** - Presenter, interactor patterns

Skills are customized to understand your specific architecture's naming conventions and structure.

#### Loading Indicator Auto-Detection
Greps source code for platform-specific loading patterns:
- **Android**: CircularProgressIndicator, LinearProgressIndicator, ProgressBar, ShimmerEffect, ContentLoadingProgressBar
- **iOS**: UIActivityIndicatorView, ProgressView, SkeletonView
- **Flutter**: CircularProgressIndicator, LinearProgressIndicator, Shimmer
- **React Native**: ActivityIndicator, SkeletonPlaceholder
- **Custom**: Pattern matching for `*Loading*`, `*Spinner*`, `*Shimmer*`, `*Skeleton*`

Test executor automatically waits for your specific loading indicators during test execution.

#### Flakiness Detection
Intelligent analysis to distinguish bugs from timing issues:
- Automatic retry on suspected timing failures
- Retry behavior flagged in results
- Root cause analysis (loading delay, animation, network dependency)
- Test improvement suggestions

#### Semantic Visual Testing
AI-powered screenshot comparison that focuses on functionality:
- Screen identity verification
- Key element presence/absence checking
- Text content validation
- Layout structure comparison
- Tolerant to minor rendering differences (anti-aliasing, font smoothing)
- Resilient to cosmetic changes while catching functional regressions

---

### 📂 Project Structure

Generated workspace structure after setup:

```
your-mobile-project/
├── mobile-automator/               # Test artifacts
│   ├── config.json                # Auto-generated project config
│   ├── index.md                   # Documentation
│   ├── scenarios/                 # Test scenario JSON files
│   ├── screenshots/               # Reference screenshots
│   └── results/                   # Test execution reports
│
└── .gemini/
    └── skills/                    # Generated testing skills
        ├── mobile-automator-generator/
        │   ├── SKILL.md          # Customized for YOUR project
        │   └── references/
        │       └── scenario_schema.json
        └── mobile-automator-executor/
            ├── SKILL.md          # Customized for YOUR project
            └── references/
                └── result_schema.json
```

---

### 🔧 Technical Details

#### Integration with mobile-mcp
- Automation engine: `@mobilenext/mobile-mcp@latest`
- Delivered via `npx` for zero-install friction
- Provides cross-platform device automation primitives:
  - `mobile_launch_app`, `mobile_click_on_screen_at_coordinates`
  - `mobile_take_screenshot`, `mobile_save_screenshot`
  - `mobile_type_keys`, `mobile_swipe_on_screen`
  - `mobile_list_elements_on_screen`, `mobile_press_button`
  - `mobile_open_url`, `mobile_list_available_devices`

#### Template System
- 13 customizable placeholders for project-specific skills
- Automatic population from codebase analysis
- Verification that no placeholders remain after installation
- Schema files automatically distributed to workspace

#### State Management
- `mobile-automator/setup_state.json` tracks setup progress
- Resume capability at any section
- Rollback protection for safe interruption
- **No automatic git commits**: User maintains full control over version control
  - Setup creates files but doesn't commit them
  - Users can review changes before committing
  - Supports custom commit message conventions and workflows

---

### 📚 Documentation

#### User Documentation
- **README.md**: Comprehensive user guide with quick start, examples, and troubleshooting
- **mobile-automator/index.md**: Generated project-specific documentation

#### Developer Documentation
- **CLAUDE.md**: Architecture, workflows, and development guide
- **GEMINI.md**: AI context with schema registry and tool mappings

#### Schema Documentation
- **scenario_schema.json**: Formal JSON schema for test scenarios
- **result_schema.json**: Formal JSON schema for execution results

---

### 🎨 User Experience

#### Interactive Setup
- Smart defaults based on project detection
- Confirmation prompts for all detected values
- User correction capability for any auto-detected value
- **Sequential question flow**: Questions asked one at a time with explicit wait steps
  - No more simultaneous questions causing confusion
  - Clear "WAIT for response" instructions prevent AI from jumping ahead
  - Two-step process: confirm auto-detected values → then ask for business-critical paths
- Clear progress indicators
- Resumable workflow

#### Multi-Format Input
Test generation accepts various natural language formats:
- **Numbered lists**: `1. open app 2. tap login 3. enter email`
- **Arrow notation**: `fresh install -> open -> validate UI`
- **Conversational**: Full sentences describing the flow

#### Rich Reporting
Execution reports include:
- Pass/fail summary with counts
- Per-step execution details
- Screenshot evidence for every checkpoint
- Flakiness flags with retry information
- Regression observations
- State context for failures
- Suggestions for test improvements

---

### 🔐 Best Practices Built-In

#### Security
- Protected directories detection prevents source code modification
- Read-only operations during test generation
- No credentials or secrets in generated files

#### Reliability
- Automatic retry logic for flaky steps
- State management for resumable operations
- Validation at every stage
- Schema enforcement for data integrity

#### Maintainability
- Clean 3-tier architecture
- Separation of concerns (infrastructure vs domain logic)
- Template-based skill generation for consistency
- Git integration for change tracking

---

### 🚀 Getting Started

```bash
# Install extension
gemini extensions install https://github.com/sh3lan93/mobile-automator

# Navigate to mobile project
cd your-mobile-project

# Run setup (one time)
gemini
> /mobile-automator:setup

# Generate test
> /mobile-automator:generate

# Execute test
> /mobile-automator:execute scenario_name
```

---

### 📦 What's Included

- Extension manifest with MCP server integration
- Three command files (setup, generate, execute)
- Two skill templates with 13 customizable placeholders
- Two JSON schemas (scenario, result)
- Comprehensive documentation (README, CLAUDE.md, GEMINI.md)
- Example scenarios and usage patterns
- Troubleshooting guides

---

### 🙏 Acknowledgments

- **mobile-mcp**: Device automation engine
- **Gemini CLI**: AI-powered CLI platform

---

### 📄 License

Apache License 2.0

---

### 🔗 Links

- **Repository**: https://github.com/sh3lan93/mobile-automator
- **Issues**: https://github.com/sh3lan93/mobile-automator/issues
- **Documentation**: https://github.com/sh3lan93/mobile-automator#readme

---

**Mobile Automator 0.9.0** - Built with ❤️ for mobile QA engineers
