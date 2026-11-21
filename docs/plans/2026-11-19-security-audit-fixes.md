# Security hardening (gate #343): implementation plan

> **Start here.** This is the single plan for milestone `security-hardening` (gate [#343](https://github.com/sh3lan93/mobile-automator/issues/343), slices #344–#349 and #353). Every agent picking up a slice reads the gate issue, then this plan's section for its slice, then the slice issue. Follow the milestone workflow in `CLAUDE.md`.

| Slice | Issue | Plan section | Blocked by |
|---|---|---|---|
| S1: session end never group-kills an unproven daemon | #344 | PR 1 / Task 1 | — |
| S2: safe-fs helper for all workspace file I/O | #345 | PR 2 / Tasks 2–3 | D2 on #343 |
| S3: authenticate the session socket by owner-only directories | #346 | PR 3 / Task 4 | #345, D2 |
| S4: confine init, setup, log, screenshot, crash-output and replay writes | #347 | PR 4 / Task 5 | #345 |
| S5: per-user telemetry consent, egress re-check, untrusted spool | #348 | PR 5 / Task 6 | #345, D1 |
| S6: neutralise terminal control characters in device text | #349 | PR 6 / Task 7 | — |
| S7: neutralise control characters in raw output and the diagnose stack trace | #353 | PR 7 / Task 8 | #349 |

> **Status** (which slices have merged) is tracked by the checkboxes on gate #343, not here.

> **Line numbers** are from the audited commit `c296ed8`. Since then, `src/cli.js`, `src/result/store.js`, `src/setup/scaffold.js` and `src/output/envelope.js` have changed, and `src/run/*` was added. Locate code by function name, not line.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 17 confirmed findings and harden the 3 needs-validation leads from security audit run-2. mauto must stop treating a committed or foreign `.mobile-automator/` as trusted local state, and the session socket must stop accepting peers it cannot vouch for.

**Architecture:** One new module, `src/workspace/safe-fs.js`, owns the rule "every path under the workspace is a real directory or a regular file, owned by the invoking user, and stays inside the workspace". Every reader and writer under `.mobile-automator/` goes through it. The session channel is authenticated by filesystem permissions: the socket always lives in a `0700` directory owned by the user, and the client checks that before it connects. This needs no native `SO_PEERCRED` addon, because a directory you cannot search is a socket you cannot connect to on both Linux and macOS. Group kills only reach daemons whose salted marker proves they are ours.

**Tech Stack:** Node ≥ the `engines.node` floor, CommonJS, `fs.constants.O_NOFOLLOW`, jest. No new dependencies.

**Spec:** This plan plus the slice issues. It comes from a local security audit (2026-11, 17 confirmed findings and 3 needs-validation leads, each reproduced in an isolated Linux sandbox). The detailed audit records are held privately by the maintainer until the fixes ship (D3). Each task's tests encode the required behaviour, so no agent needs the records.

## Global Constraints

- Locked invariants in `CLAUDE.md` hold. In particular, every verb keeps the `{ok,data,error,hint,schema_version}` envelope, and the `.mobile-automator/` layout and schemas stay backwards compatible. Every refusal is a `fail('environment', …)` envelope that names the path and the reason, never the content.
- No new runtime dependency, and no native addon.
- Supported hosts are `darwin` and `linux` only, so `process.getuid()` and `O_NOFOLLOW` are always available.
- One issue and one PR per slice below, on branch `fix/<issue>-<slug>` in its own worktree. Each PR is a single-PR bugfix: bump the patch version to a graduated `X.Y.Z` that is not yet tagged, and rename `[Unreleased]` in `CHANGELOG.md`.
- `Closes #<issue>` goes on its own line, plus `Refs #343`. Never `Closes #343`: the gate closes when its last slice merges.
- Before any success claim, run `npm test`, `npm run lint` and `npm run lint:guides` and show the output.
- Test fixtures use `fs.mkdtempSync(os.tmpdir())` plus dummy files. No test touches a real device, the network, or a path outside its temp dir. "Foreign owner" is simulated by injecting `lstatSync`/`fstatSync`, because jest cannot chown.

## Review Focus

1. **Group-writable on Linux.** On Ubuntu, a umask of `002` with a per-user private group makes every directory `g+w`. A check that rejects `g+w` would lock out ordinary users, so safe-fs rejects only world-writable directories (`mode & 0o002`) and leaves `g+w` alone. Test it in Task 2.
2. **CI containers running as root over a checkout owned by another uid** (GitHub Actions container jobs). An owner check fails the same way git's "dubious ownership" check does. Escape hatch: `MAUTO_TRUST_WORKSPACE_OWNER=1` skips **only** the owner comparison, never the symlink or containment checks. Test it in Task 2. (Decision D2.)
3. **Upgrading with a daemon still running.** An old daemon whose socket sits under the old `/tmp/mauto-<key>.sock`, or in a `.session/` that is not `0700`, must not turn every verb into a lock conflict. The client treats an unverifiable socket as "no daemon", and the daemon tightens `.session/` itself at its next start. The `ELOCKED` hint gains `mauto session end`. Test it in Task 4.
4. **A workspace reached through a symlinked project root** (macOS `/tmp` → `/private/tmp`, a symlinked checkout). Containment compares realpaths, and only components *below* the project root are checked for symlinks. Test it in Task 2.
5. **`mauto screenshot /tmp/x.png` chosen explicitly by the agent** must keep working. Confinement applies only when the resolved destination falls under the workspace. Test it in Task 5.

---

## PR 1 (#344): `session end` never group-kills an unproven daemon (C-2, medium)

### Task 1: Report `unmarked` daemons instead of signalling them

Finding: `src/device/session-end.js:endSession:unmarked-group-kill-trusts-unauthenticated-ack-and-committed-lock`.

**Files:**
- Modify: `src/device/session-end.js:89-107`
- Modify: `src/device/process-identity.js:128-135` (`readPidFile`)
- Test: `tests/unit/device/session-end.test.js`, `tests/unit/device/daemon-pid-identity.test.js`

**Interfaces:**
- Produces: the `endSession` outcome `'unmarked'` becomes `'unproven'` whether or not the shutdown was acked. `ENDED_OUTCOMES` is unchanged. `readPidFile(file)` returns `null` for anything that is not a regular file. It opens with `O_RDONLY|O_NOFOLLOW|O_NONBLOCK`, `fstat().isFile()` must be true, and it reads at most 32 bytes.

- [ ] **Step 1: Write the failing tests.**
  - `'unmarked + acked + lock names the same pid → unproven, never terminate()'`: the reaper spy's `terminate` has zero calls, and the outcome is `'unproven'`.
  - `readPidFile on a symlink to a file containing "1234" → null`.
  - `readPidFile on a FIFO → null, does not block` (`mkfifo` via `child_process.execFileSync('mkfifo')`; skip if it is unavailable).
- [ ] **Step 2: Run** `npx jest tests/unit/device/session-end.test.js tests/unit/device/daemon-pid-identity.test.js`. Expected: FAIL. The current code calls `terminate` with `{group:true}`.
- [ ] **Step 3: Implement.** Delete the `acked && lockPid === pid` branch. `readLockPid` and its default stay only if another caller uses them; otherwise remove them. Update the comment block (#237): "a marker-less daemon is never signalled; the hint tells the user to stop it by pid." Find the CLI hint for `unproven` (`grep -n "unproven" src/cli.js`) and make sure it names `kill <pid>`.
- [ ] **Step 4: Run** the same tests plus `npx jest tests/unit/device`. Expected: PASS.
- [ ] **Step 5: Commit** `fix(session)!: never group-kill a daemon whose command line names no workspace`, then bump the version and add a CHANGELOG entry under **Security**.

---

## PR 2 (#345): Workspace safe-fs helper, applied to stores, atomic writes and locks

Findings: `src/memory/store.js:_safeRead+src/config/manager.js:load:workspace-file-symlink-read-follow`, `src/util/atomic.js:atomicWrite:committed-workspace-dir-symlink-write-escape`, `src/util/lock.js:acquire:dangling-symlink-unbounded-spin`, and NV `src/result/store.js:ResultStore:runId-path-traversal`.

### Task 2: `src/workspace/safe-fs.js`

**Files:**
- Create: `src/workspace/safe-fs.js`
- Test: `tests/unit/workspace/safe-fs.test.js`

**Interfaces (produced, used by every later task):**
```js
class UnsafePathError extends Error {}   // code 'EUNSAFEPATH'; .path; .reason ∈
                                         // 'symlink'|'escape'|'foreign_owner'|'not_regular'|'not_directory'|'world_writable'|'hardlink'
function safeDir(projectRoot, dir, { create = false, mode } = {}) -> string           // realpath of dir
function readWorkspaceFile(projectRoot, file, { maxBytes = 16 * 1024 * 1024 } = {}) -> string | null   // null = ENOENT
function openWorkspaceFile(projectRoot, file, flags, mode = 0o666) -> number          // fd; O_NOFOLLOW always added
function unsafePathFailure(err) -> { envelope, exitKind: 'environment' }
// all take an optional last-arg deps bag { fs, getuid, env } for tests
```
Rules: `safeDir` walks every component from `workspaceDir(projectRoot)`, including `.mobile-automator` itself, down to `dir`, using `lstatSync`. A symlink → `symlink`. A non-directory → `not_directory`. `uid !== getuid()`, unless `env.MAUTO_TRUST_WORKSPACE_OWNER === '1'` → `foreign_owner`. `mode & 0o002` → `world_writable`. A missing component, when `create` is set, is made with `mkdirSync(p, { mode })` and then re-checked. Finally `realpath(dir)` must start with `realpath(workspaceDir) + sep`, or equal it; otherwise → `escape`. `dir` outside `workspaceDir` → `escape` (callers never pass one). Leaf files: open with `O_NOFOLLOW|O_NONBLOCK`, map `ELOOP` → `symlink`, then require `fstat` `isFile()`, owner as above, and `nlink === 1` (else `hardlink`) for opens that write.

- [ ] **Step 1: Write failing tests.** One `it` per reason:
  - each refusal throws `UnsafePathError` with that `reason`, and the target outside the workspace is byte-identical afterwards;
  - `readWorkspaceFile` returns `null` on ENOENT;
  - `g+w` is accepted (Review Focus 1);
  - `MAUTO_TRUST_WORKSPACE_OWNER=1` accepts a foreign uid but still refuses a symlink (Review Focus 2);
  - a project root reached through a symlinked parent is accepted (Review Focus 4);
  - `unsafePathFailure` never puts file content in the envelope.
- [ ] **Step 2: Run** `npx jest tests/unit/workspace/safe-fs.test.js`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** to the rules above.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(workspace): safe-fs helper for symlink-free, owner-checked workspace I/O`.

### Task 3: Route the stores, atomicWrite and lock through safe-fs; validate runId

**Files:**
- Modify: `src/util/atomic.js` (signature becomes `atomicWrite(file, contents, { projectRoot } = {})`):
  - with `projectRoot`, call `safeDir(projectRoot, dirname(file), { create: true })` instead of `mkdirSync`;
  - always open the tmp file with `O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW`.
- Modify: `src/util/lock.js`:
  - call `backoffOrThrow()` on the ENOENT path as well;
  - use `lstatSync` instead of `statSync`, and treat a non-regular entry as stale (unlink and retry, bounded by the deadline);
  - `acquire(lockPath, { projectRoot, now, sleep })` uses `safeDir` when `projectRoot` is given.
- Modify: `src/memory/store.js:102,215` → `readWorkspaceFile`; pass `projectRoot` to `atomicWrite`.
- Modify: `src/config/manager.js:24,44-45` → `readWorkspaceFile` / `atomicWrite`.
- Modify: `src/result/store.js:41-55`:
  - the constructor throws `invalid_input` when `!isValidRunId(runId)` (import from `src/observe/paths.js`);
  - lines 99, 124-129 and 147 go through safe-fs.
- Modify: `src/device/selection.js:30,43`, `src/device/session-handle.js:26` and `src/device/session-salt.js:28,51-58` → safe-fs.
- Modify: `src/cli.js`, where each `requireWorkspace` handler catches `UnsafePathError` → `unsafePathFailure(err)`. Do this in one place if `requireWorkspace` wraps the handler call; otherwise add a catch at each `try` that already maps store errors.
- Test: `tests/unit/util/atomic.test.js` (new), `tests/unit/util/lock.test.js` (new), `tests/unit/memory/*`, `tests/unit/config/*`, `tests/unit/result/*`, `tests/unit/cli-workspace-safety.test.js` (new).

- [ ] **Step 1: Write failing tests.**
  - `lock: acquire on a dangling symlink throws within MAX_WAIT_MS` (inject `now` and `sleep`; assert it throws and `sleep` was called fewer than `MAX_WAIT_MS / RETRY_MS + 2` times).
  - `atomicWrite refuses memory/ -> outside dir` (absolute and relative symlink): it throws `UnsafePathError`, and `outside/run-history.md` is unchanged.
  - `ResultStore rejects runId "../../../outside/v" and "/../x" before any fs call` (spy on `fs`: zero calls).
  - CLI-level: `memory show`, `config get mode`, `result finalize` and `devices use` each run against fixtures with a symlinked `memory/run-history.md`, a symlinked `config.json`, a symlinked `results/` and a symlinked `.session/`, each pointing at an outside file containing `SECRET-CANARY`. Each verb returns `ok:false` with `error.kind === 'environment'`, stdout never contains `SECRET-CANARY`, and outside files are unchanged.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** the modifications listed above.
- [ ] **Step 4: Run** `npm test`. Expected: PASS, with no change to existing tests other than the call-signature updates.
- [ ] **Step 5: Commit** each in turn:
  1. `fix(util): lock honours its deadline on a dangling symlink`
  2. `fix(workspace): stores read and write only through safe-fs`
  3. `fix(result): reject an invalid --run-id before touching the filesystem`

  Then bump the version and update the CHANGELOG.

---

## PR 3 (#346): Authenticated session channel (C-1, medium, plus the session and discovery lows)

Findings:
- `src/device/session-paths.js:socketPath/tmpdir-fallback-unauthenticated-peer`
- `sessiondaemon:…no-peer-auth-mode-umask-derived`
- `src/device/session-client.js:connectSocket:unauthenticated-peer-via-workspace-socket-symlink`
- `src/device/session-daemon.js:cleanStale/self-pid-symlink-bypass-handle-write`
- `src/device/session-daemon.js:startDaemon:handle-pidfile-write-follows-symlink-in-foreign-session-dir`
- `src/workspace/discover.js:findWorkspaceRoot:no-ownership-check`

### Task 4: Private socket directory, client-side verification, safe daemon files

**Files:**
- Modify: `src/device/session-paths.js`:
  - `socketPath(projectRoot, { env, getuid })`: the fallback becomes `path.join(privateSocketDir(...), workspaceKey(root) + '.sock')`;
  - add `privateSocketDir({ env = process.env, getuid = process.getuid } = {}) -> string`, which returns `env.XDG_RUNTIME_DIR/mauto` when that variable is set and absolute, otherwise `path.join(os.tmpdir(), 'mauto-' + getuid())`;
  - it stays pure, with no I/O.
- Create: `src/device/session-dir.js`:
  - `ensureSessionDirs(projectRoot) -> void`:
    - `safeDir(root, sessionDir(root), { create: true, mode: 0o700 })`, then `chmodSync(…, 0o700)`;
    - when `socketPath` is the fallback, create its parent with `mode 0o700`, then `lstat` it: it must be a directory with `uid === getuid()` and `(mode & 0o077) === 0`, else throw `UnsafePathError('foreign_owner' | 'world_writable')`.
  - `verifySocket(socketFile) -> boolean`: `lstat` the parent directory (owner, `mode & 0o077 === 0`, not a symlink), then `lstat` the socket (`isSocket()`, owner). It returns false and never throws.
- Modify: `src/device/session-daemon.js`:
  - at `:192-203`, replace `mkdirSync` with `ensureSessionDirs`;
  - at `:76` (`cleanStale`), read the pid via `readPidFile` (already NOFOLLOW from PR 1), and drop the `pid === process.pid` short-circuit outside tests by injecting `{ selfPid }`;
  - at `:216`, open the lock with `openWorkspaceFile(…, O_WRONLY|O_CREAT|O_EXCL)`;
  - at `:704`, set `process.umask(0o077)` around `listen`, then `chmodSync(socketPath, 0o600)`, and treat a failed unlink of an existing foreign socket as a hard start failure;
  - at `:744-745`, write through `atomicWrite(…, { projectRoot })`.
- Modify: `src/device/session-log.js:49-57` → `openWorkspaceFile(…, O_WRONLY|O_APPEND|O_CREAT)`. On `UnsafePathError`, return no log fd (degrade, don't fail start).
- Modify: `src/device/session-client.js`: every entry point (`tryConnect`, `isAlive`, `requestShutdown`, `getSessionStatus`) calls `verifySocket(paths.socketPath(root))` first. When that is false, it returns the "no daemon" value **without connecting**. Exception: `requestShutdown` still returns `false` so `session end` falls through to pid identity.
- Modify: `src/workspace/discover.js:55-68`: inject `lstatSync`/`getuid`/`env` alongside `existsSync`. When the marker directory or `config.json` is a symlink, foreign-owned (unless the env override is set), or world-writable, stop and return `{ root: null, searched, legacy: null, unsafe: { path, reason } }`. `workspaceFailure` renders `unsafe` as an `environment` failure naming the path and the owner uid.
- Test: `tests/unit/device/session-paths.test.js`, `tests/unit/device/session-dir.test.js` (new), `tests/unit/device/session-client.test.js`, `tests/unit/device/session-daemon.test.js`, `tests/unit/workspace/discover.test.js`.

- [ ] **Step 1: Write failing tests.**
  - `socketPath fallback sits under mauto-<uid>/` (a long root, `getuid: () => 1234`) → `/<tmp>/mauto-1234/<16hex>.sock`; `XDG_RUNTIME_DIR=/run/user/1234` → `/run/user/1234/mauto/<16hex>.sock`. The existing `workspaceKey` pin is unchanged.
  - `ensureSessionDirs refuses a pre-existing fallback dir owned by another uid` (injected `lstat` with `uid: 9999`) → throws `foreign_owner`.
  - `verifySocket false for: symlinked mauto.sock, symlinked .session, socket uid mismatch, parent mode 0o755`.
  - `isAlive/tryConnect never connect when verifySocket is false`: a real `net.createServer` listener at a symlinked path records zero connections, `tryConnect` returns `null` and `isAlive` returns `false`.
  - `daemon: planted daemon.pid -> /proc/self/stat and session.json -> outside file`: start the daemon in-process with a fake engine (reuse the `session-daemon.test.js` fixture). The outside file is byte-identical and the start fails with `UnsafePathError` or rewrites `.session/` only.
  - `daemon: socket mode is 0600 and .session is 0700 after start, under umask 0o022`.
  - `discover: foreign-owned .mobile-automator is not adopted` (`lstat` uid 9999) → `root: null`, `unsafe.reason === 'foreign_owner'`; `discover: symlinked .mobile-automator is not adopted`.
  - Upgrade (Review Focus 3): `.session/` at mode `0o755` with a live old-style listener → `isAlive` is false, and the next `ensureSessionDirs` call leaves it `0o700`.
- [ ] **Step 2: Run** `npx jest tests/unit/device tests/unit/workspace`. Expected: FAIL.
- [ ] **Step 3: Implement** the modifications listed above.
- [ ] **Step 4: Run** `npm test` and `npm run test:integration`. Expected: PASS. The CLI smoke tests spawn real daemons, which exercises the `0700` path.
- [ ] **Step 5: Commit** in order: (1) socket path, (2) session dir and daemon files, (3) client verification, (4) discovery. Then bump the version, add a CHANGELOG **Security** entry, and add a `TROUBLESHOOTING.md` entry: "`environment`: `.mobile-automator` owned by uid N" with `MAUTO_TRUST_WORKSPACE_OWNER=1`.

---

## PR 4 (#347): Remaining writers (init, setup, logs, screenshots, crash output)

Findings: `src/init/adapters.js:writeIfChanged:symlink-follow`, `src/observe/sinks/file.js:write/workspace-log-symlink-follow`, `src/observe/failure-capture.js:captureOnFailure+src/cli.js:handleScreenshot:workspace-screenshot-symlink-to-shared-tmp`, NV `src/cli.js:handleCrashGet:out-path-unconfined`.

### Task 5: Confine every remaining write

**Files:**
- Modify: `src/init/adapters.js:22-55`. `init` writes outside `.mobile-automator/` (host files such as `.claude/…` and `AGENTS.md`), so add `safeProjectPath(projectRoot, file, deps) -> string` to `safe-fs.js`. It applies the same component walk rooted at `projectRoot` instead of `workspaceDir`, minus the owner check on the project root itself. Writes go through `atomicWrite`; reads go through a NOFOLLOW open.
- Modify: `src/setup/scaffold.js:43,63,76` → `safeDir` / `atomicWrite`.
- Modify: `src/observe/sinks/file.js:93-95` → `openWorkspaceFile(…, O_WRONLY|O_APPEND|O_CREAT)`. On `UnsafePathError`, drop the event silently: a sink must never fail a verb.
- Modify: `src/util/log-rotate.js:28` → `lstatSync`, and skip rotation when the path is not a regular file.
- Modify: `src/observe/failure-capture.js:118` → `safeDir(root, dirname(dest), { create: true, mode: 0o700 })`.
- Modify: `src/cli.js:205` (`handleScreenshot`): when `path.resolve(cwd, destPath)` is inside `workspaceDir(projectRoot)`, call `safeDir` on its parent first; otherwise leave it unchanged (Review Focus 5).
- Modify: `src/cli.js:1722-1745` (`handleCrashGet --out`):
  - open with `O_WRONLY|O_CREAT|O_TRUNC|O_NOFOLLOW`;
  - refuse unless `realpath(dirname(out))` is inside `realpath(projectRoot)` or `realpath(os.tmpdir())`, the same rule the engine applies to screenshots;
  - refuse with `invalid_input` and a hint naming the allowed roots.
- Modify (added after the audit, so not audited, but the same class of sink): the replay writers under `src/run/` that write inside the workspace go through safe-fs. These are `handle.js` (`writeFile = atomicWrite`: pass `{ projectRoot }`) and `reference-screenshot.js` (the diff PNG `writeFileSync`: `safeDir` on its parent and an `O_NOFOLLOW` open). Run `git grep -n "writeFileSync\|atomicWrite\|mkdirSync" src/run` and cover every hit that writes under `workspaceDir`.
- Test: `tests/unit/init/*`, `tests/unit/setup/*`, `tests/unit/observe/sinks.test.js`, `tests/unit/observe/failure-capture.test.js`, `tests/unit/cli/crash-get-out.test.js` (new), `tests/unit/cli/screenshot-confine.test.js` (new).

- [ ] **Step 1: Write failing tests.**
  - `init --agent claude with .claude/skills -> outside dir`: `fail('environment')`, and the outside dir stays empty.
  - The same test with a leaf symlink and a dangling symlink.
  - `file sink with .logs -> outside dir`: no write, and no throw.
  - `captureOnFailure with screenshots -> 0777 tmp dir`: refused, nothing written outside.
  - `screenshot .mobile-automator/screenshots/a.png with screenshots symlinked`: refused.
  - `screenshot /tmp/<mkdtemp>/a.png`: still calls the bridge with that path.
  - `crash get --out ../outside.txt`, `--out` set to an in-workspace symlink to an outside file, and `--out` set to a dangling symlink: all return `ok:false`, and the target is absent or unchanged.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** the modifications listed above.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** per area, then bump the version and update the CHANGELOG.

---

## PR 5 (#348): Telemetry consent and spool

Findings: `src/observe/telemetry.js:resolveTelemetry:committed-workspace-config-opt-in`, `src/observe/telemetry.js:decideForProject:daemon-memo-ignores-consent-withdrawal`, `src/observe/spool.js:readBatch+src/observe/transport.js:toWireEvent:flush-uploads-repo-supplied-spool-without-allowlist-or-nofollow`.

### Task 6: Consent outside the repo, rechecked at egress; untrusted spool

**Files:**
- Create: `src/observe/consent.js`:
  - `consentPath({ env, home }) -> string`: `$XDG_CONFIG_HOME/mauto/telemetry-consent.json`, else `~/.config/mauto/telemetry-consent.json`;
  - `hasLocalConsent(projectRoot, deps) -> boolean`: is the realpath of the project root a key with value `true`;
  - `setLocalConsent(projectRoot, value, deps) -> void`: atomicWrite, file `0600`, dir `0700`.
- Modify: `src/observe/telemetry.js`:
  - add the reason `'not_consented_locally'` to `REASONS`;
  - `resolveTelemetry({ env, config, localConsent })` → `config.telemetry.enabled === true && localConsent` (decision D1);
  - add an unmemoised `decideNow(projectRoot, env) -> decision`;
  - `setEnabled` writes both the config and the local consent.
- Modify: `src/observe/flush.js` (`makeFlusher`): call `decideNow` before each upload, and when it is disabled, upload nothing (leave the spool in place).
- Modify: `src/observe/recorder.js`: the daemon's spool sink re-checks `decideNow` at most once per 1000 ms.
- Modify: `src/observe/spool.js:152-155` (`readBatch`): `openWorkspaceFile(O_RDONLY)`, regular file, owner, `nlink === 1`, cap 1 MiB. Re-apply `telemetryPayload()` to each parsed line and drop lines that come back empty.
- Modify: `src/observe/transport.js:63` (`toWireEvent`): re-apply `telemetryPayload()`.
- Modify: `src/cli.js:947` (`handleSetup`) reports `decideForProject(root)` instead of a constant. `src/cli.js:1102` (`handleTelemetryDisable`): the hint names `mauto session end`.
- Modify: `docs/reference/telemetry.md`, which explains the per-user consent record.
- Test: `tests/unit/observe/telemetry.test.js`, `tests/unit/observe/consent.test.js` (new), `tests/unit/observe/spool.test.js`, `tests/unit/observe/transport.test.js`, `tests/unit/observe/flush.test.js`, `tests/unit/cli.test.js`.

- [ ] **Step 1: Write failing tests.**
  - `committed enabled:true without local consent → enabled:false, reason 'not_consented_locally', no spool file created` (including with a file planted at `.session/telemetry-consent.json`).
  - `setup on an existing enabled:true workspace reports data.telemetry.enabled === decideForProject(root).enabled`.
  - `flusher uploads nothing after config flips to disabled mid-daemon` (transport spy: 0 calls).
  - `readBatch skips a symlinked spool and a spool owned by another uid`.
  - `toWireEvent drops a field outside EVENT_FIELDS` (spool line `{"verb":"tap","cwd":"/home/x"}` → no `cwd` on the wire).
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** the modifications listed above.
- [ ] **Step 4: Run** `npm test` and `npm run lint:guides`. Expected: PASS. The telemetry docs guard renders from the catalog, so check it still agrees.
- [ ] **Step 5: Commit** and bump the version. The CHANGELOG notes that existing opt-ins must re-run `mauto telemetry enable` once.

---

## PR 6 (#349): Terminal-control neutralisation

Findings: `termesc:src/device/element-model.js:decodeEntities:entity-decode-mints-control-chars`, NV `termesc:src/output/envelope.js:render-human+src/observe/sinks/stderr.js:write:device-text-unneutralised`.

### Task 7: Never mint or print raw control characters

**Files:**
- Create: `src/output/neutralise.js`. `neutraliseControls(s: string) -> string` replaces `[\u0000-\u0008\u000B-\u001F\u007F-\u009F]` with `\\xHH` (or `\\u00HH` for C1). It keeps `\n` and `\t`.
- Modify: `src/device/element-model.js:48-57`. `decodeEntities` leaves a numeric reference as received (`whole`) when its code point is C0 other than `\t` and `\n`, is `0x7f`, or is C1.
- Modify: `src/output/envelope.js`, `--human` branch only. Apply `neutraliseControls` to every string it prints. JSON output is unchanged, because JSON already escapes C0. Also escape U+0080–U+009F in the JSON render (`render` post-processes `JSON.stringify` output with `/[\u0080-\u009f]/g` → `\\u00XX`).
- Modify: `src/output/run-human.js` (added after the audit): pass every device- or scenario-sourced string it prints through `neutraliseControls`.
- Modify: `src/observe/sinks/stderr.js:16`. `parts.push(\`${k}=${neutraliseControls(String(v))}\`)`.
- Test: `tests/unit/device/element-model.test.js`, `tests/unit/output/envelope.test.js`, `tests/unit/observe/sinks.test.js`, `tests/unit/output/neutralise.test.js` (new).

- [ ] **Step 1: Write failing tests.**
  - `decodeEntities('&#27;[2J')` contains no `\x1b` and equals `'&#27;[2J'`.
  - `decodeEntities('Home&#10;Tab')` is still `'Home\nTab'` (#251 regression guard).
  - `render(fail('device', '\x1b[2J\u009b'), { human: true })` does not match `/[\x00-\x08\x0b-\x1f\x7f-\x9f]/`.
  - `JSON render of a C1 char contains '\\u009b'` and no raw U+009B.
  - stderr sink with `message: '\x1b]0;x\x07'` → the line contains no `\x1b` and no `\x07`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** the modifications listed above.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** and bump the version.

---

## PR 7 (#353): Raw output and the diagnose stack trace

Follow-up to PR 6 (#349 / PR #352). It was found in that PR's review, not by the audit. Two output paths that PR 6 did not list still print text without neutralising it.

### Task 8: Route `emitRaw` and `diagnose` through `neutraliseControls`

**Files:**
- Modify: `src/cli.js`, `emitRaw` in the per-invocation emitters (stdout for `guide`, `schema`, `bootstrap` and `memory show`). Pass `content` through `neutraliseControls(content)` with its default options, which keep `\n` and `\t`. All four reach it through `emitMaybeRaw`. Two of them print workspace-controlled text: `memory show` (the memory markdown) and `guide` (whose placeholders are filled from `config.json`). The shipped guide content and the schema JSON hold no controls, so their output stays byte-identical.
- Modify: `src/cli.js`, `diagnose(err, exitKind)`. Write `neutraliseControls(err.stack)`. Keep the stack's own line breaks: do **not** set `escapeNewlines`, because an `internal` error message can carry device text.
- Reuse `src/output/neutralise.js` as is. Do not add a second regex (CLAUDE.md step 8).
- Test: `tests/unit/cli-envelope-boundary.test.js` (it already exercises `diagnose`) and a `memory show` case. Put the `memory show` case wherever `memory show` is already tested (`grep -rln "memory show" tests/unit`).

- [ ] **Step 1: Write failing tests.**
  - `memory show` on a fixture whose `run-history.md` contains `\x1b[2J` and `\u009b`: stdout does not match `/[\x00-\x08\x0b-\x1f\x7f-\x9f]/`, and the lines and tabs of the entry are kept.
  - `guide <topic>` with a `config.json` placeholder value containing `\x1b[2J`: stdout contains no `\x1b`.
  - `guide <topic>` on a clean config: stdout is byte-identical before and after the change (a regression guard against escaping clean text).
  - An `internal` error whose message is `'boom\x1b]0;x\x07'`: stderr contains no `\x1b` and no `\x07`, and still has more than one line.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** the modifications listed above.
- [ ] **Step 4: Run** `npm test`, `npm run lint` and `npm run lint:guides`. Expected: PASS.
- [ ] **Step 5: Commit** and bump the patch version.

---

## Decisions to confirm before PR 3 and PR 5

> D2 was approved on #343 on 2026-11-19. D1 and D3 are open; their state lives on the gate.

- **D1 (PR 5): telemetry consent moves to a per-user file outside the repo.** Recommended. A committed `telemetry.enabled: true` alone no longer turns telemetry on. Cost: anyone who opted in today stops sending until they run `mauto telemetry enable` again. The alternative is the minimum fix: setup reports the real decision, and egress is rechecked. That keeps the committed opt-in, so the finding stays open.
- **D2 (PR 2/3): owner-check escape hatch `MAUTO_TRUST_WORKSPACE_OWNER=1`.** Recommended, modelled on git's `safe.directory`. Without it, root-in-container CI over a checkout owned by another uid gets an `environment` failure on every verb.
- **D3: disclosure.** The repo is public. Recommendation: open one terse issue per PR that names the hardening, not the exploit, and keep the detailed audit reports private until the fixes ship. (The issues were filed this way.) Alternatively, file a GitHub private security advisory for C-1 and C-2.

## Not covered by this plan

- U31 (iOS-simulator crash id) needs macOS with a booted simulator. Re-audit after PR 4.
- The 12 areas the first audit pass covered from source only, plus the replay code (`src/run/*`) added after the audited commit.
- After all six PRs merge, the maintainer re-runs the audit's sandbox checks against the new commit. The gate's exit criterion is that no confirmed finding reproduces.
