# Daemon Lifecycle Honesty Implementation Plan (#156)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the device session daemon honest about its lifecycle — bounded engine connect, no orphaned daemons after a spawn timeout, `session end` that reports `stopped:true` only after the daemon is gone, and a daemon that reaps itself when its engine dies.

**Architecture:** A new pure module `src/device/process-reaper.js` owns process termination (`waitForDeath`, `terminate`). `createCall` gains a bounded connect and an `onEngineExit` signal (via the SDK's `client.onclose`). The daemon turns that signal into `stop('engine_exit')`. `session-spawn` kills its own unready child's process group. `connection.endSession` waits for death and escalates an identity-checked stuck daemon. `getSessionStatus` reports `reason:'engine_exited'`.

**Tech Stack:** Node `>=22.12.0`, CommonJS, jest, `@modelcontextprotocol/sdk` 1.32.1, `@mobilenext/mobile-mcp` 1.0.5.

**Spec:** `docs/plans/2026-10-15-daemon-lifecycle-156-design.md`

## Global Constraints

- Work in `/Users/mohamedshalan/orca/workspaces/mobile-automator/bug-daemon-lifecycle-unbounded-mobile-mcp-connec` on branch `fix/156-daemon-lifecycle`. **Subagents: `cd` there and run `git branch --show-current` before any commit; it must print `fix/156-daemon-lifecycle`.**
- `CONNECT_TIMEOUT_MS = 10000` < `DEFAULT_READY_TIMEOUT_MS = 15000`.
- `END_BUDGET_MS = DAEMON_CALL_TIMEOUT_MS + 10000` (= 35000); must be > `DAEMON_CALL_TIMEOUT_MS + 4000`.
- `ENGINE_REAP_BUDGET_MS = 5000` (covers the SDK's own stdin-end → 2s → SIGTERM → 2s ladder).
- Spawn kill grace `2000` ms per signal.
- New vocabulary, exact strings: event `daemon.engine_exit`; stop reason `engine_exit`; error codes `ENGINE_CONNECT_TIMEOUT`, `ENGINE_EXITED`; status reason `engine_exited`.
- Every verb keeps the `{ok,data,error,hint,schema_version}` envelope (`ok(data, hint)` / `fail(kind, message, hint, data)` in `src/output/envelope.js`).
- POSIX only; no Windows branch (#165).
- Never signal `process.pid`: in-process daemon tests write the test runner's pid to the pidfile.
- No new dependencies. No device needed by any test.
- Version `0.28.0` (`package.json` + `package-lock.json`).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run `npx jest <path>` for single files; `npm test` for the suite. `jest.config.js` `testPathIgnorePatterns` must stay `<rootDir>`-anchored — do not touch it.

## Review Focus

1. **`session end` against an in-process daemon (pid === `process.pid`)** — must never wait the budget or signal; the test runner must survive. → Task 5, test "never signals its own process".
2. **A 0.27.x daemon still running across the upgrade** (ping reply has no `engine_alive`) — `session status` must keep reporting `running:true`. → Task 6, test "a pre-0.28 daemon without engine_alive is running".
3. **A daemon SIGTERMed mid-startup leaves its lock behind** (no handler installed yet) — the next `startDaemon` must succeed, not ELOCKED. → Task 3, test "a lock left by a dead daemon does not block the next start".
4. **Group kill when the target is not a group leader** — `kill(-pid)` returns ESRCH while `pid` lives; `terminate` must report `'survived'`, not `'dead'`. → Task 1, test "ESRCH on the group while the pid lives is not death".
5. **A real process tree** — the fake-only tests cannot show that `-pid` reaches a grandchild. → Task 1, integration test "terminate(group) kills the leader and its child".

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/device/process-reaper.js` (create) | `waitForDeath`, `terminate` — termination mechanism, all effects injected | 1 |
| `tests/unit/device/process-reaper.test.js` (create) | reaper logic against a fake process table | 1 |
| `tests/integration/process-reaper.test.js` (create) | reaper against a real detached process tree | 1 |
| `src/device/mobile-mcp-client.js` | bounded connect, engine-exit signal, engine reap on connect failure, test seams | 2 |
| `src/device/session-spawn.js` | export `DEFAULT_READY_TIMEOUT_MS` (2); kill unready child's group (3) | 2, 3 |
| `tests/fixtures/mcp-fixture-server.js` (create) | tiny MCP server: `never-init` / `exit-after-init` / `stay-up` | 2 |
| `tests/unit/device/mobile-mcp-client-lifecycle.test.js` (create) | createCall against a fake SDK | 2 |
| `tests/integration/engine-lifecycle.test.js` (create) | createCall against the real SDK + fixture server | 2 |
| `tests/unit/device/timeout-invariant.test.js` | timeout ladder rungs | 2, 5 |
| `tests/unit/device/session-spawn.test.js` | spawn kill cases | 3 |
| `tests/unit/device/daemon-pid-identity.test.js` | dead-lock restart | 3 |
| `src/device/session-daemon.js` | engine-exit self-reap, startup check, ping `engine_alive`, export `readPidFile` | 4, 5 |
| `src/observe/vocab.js`, `src/observe/event.js` | new event / stop reason / error codes | 4 |
| `tests/lint/telemetry-vocab-drift.test.js` | stop-reason regex accepts `_` | 4 |
| `tests/unit/device/daemon-engine-exit.test.js` (create) | daemon self-reap paths | 4 |
| `src/device/connection.js` | `endSession` decision tree, `END_BUDGET_MS`, status `reason` normalisation | 5, 6 |
| `src/cli.js` | `handleSessionEnd` / `handleSessionStatus` envelopes | 5, 6 |
| `src/device/session-client.js` | `getSessionStatus` `reason` | 6 |
| `tests/unit/device/connection.test.js`, `tests/unit/cli.test.js`, `tests/unit/device/session-client.test.js` | contract tests | 5, 6 |
| `docs/reference/cli-verbs.md`, `docs/faq.md`, `docs/reference/telemetry.md`, `TROUBLESHOOTING.md`, `CHANGELOG.md`, `package.json`, `package-lock.json` | docs + release | 1, 4, 7 |

Deviation from the spec's test table: the two fixture files (`mcp-never-initializes.js`, `mcp-exits-after-init.js`) are one file with a mode argument, plus a third `stay-up` mode the "own close" test needs.

---

### Task 1: Process reaper module (+ version bump, draft PR)

**Files:**
- Create: `src/device/process-reaper.js`
- Create: `tests/unit/device/process-reaper.test.js`
- Create: `tests/integration/process-reaper.test.js`
- Modify: `package.json`, `package-lock.json` (version), `CHANGELOG.md` (new section)

**Interfaces:**
- Consumes: `pidAlive(pid) → boolean` from `src/device/session-daemon.js` (existing export).
- Produces:
  - `waitForDeath(pid, { budgetMs, pollMs = 100, isAlive = pidAlive, sleep, now = Date.now }) → Promise<boolean>`
  - `terminate(pid, { group = true, graceMs = 2000, pollMs = 50, kill = process.kill, isAlive = pidAlive, sleep, now = Date.now }) → Promise<'dead' | 'survived'>`

- [ ] **Step 1: Write the failing unit tests**

`tests/unit/device/process-reaper.test.js`:

```js
'use strict';

const { waitForDeath, terminate } = require('../../../src/device/process-reaper');

// A fake process table plus a fake clock. `kill(target, sig)` addresses -pid
// (group) or pid; each process lists the signals it dies on.
function world(procs) {
  let t = 0;
  const sent = [];
  const table = new Map(Object.entries(procs).map(([pid, p]) => [Number(pid), { alive: true, ...p }]));
  const kill = (target, sig) => {
    sent.push([target, sig]);
    const pid = Math.abs(target);
    const p = table.get(pid);
    if (p && p.eperm) {
      const e = new Error('EPERM');
      e.code = 'EPERM';
      throw e;
    }
    // A non-leader has no group: -pid is ESRCH even though pid lives.
    if (!p || !p.alive || (target < 0 && p.notLeader)) {
      const e = new Error('ESRCH');
      e.code = 'ESRCH';
      throw e;
    }
    if ((p.diesOn || []).includes(sig)) p.alive = false;
  };
  const isAlive = (pid) => {
    const p = table.get(pid);
    return !!(p && p.alive);
  };
  const now = () => t;
  const sleep = async (ms) => {
    t += ms;
  };
  return { kill, isAlive, now, sleep, sent, table };
}

describe('waitForDeath', () => {
  test('true as soon as the pid is dead', async () => {
    const w = world({ 7: { alive: false } });
    expect(await waitForDeath(7, { budgetMs: 1000, ...w })).toBe(true);
  });

  test('false once the budget elapses for a live pid', async () => {
    const w = world({ 7: {} });
    expect(await waitForDeath(7, { budgetMs: 300, pollMs: 100, ...w })).toBe(false);
    expect(w.now()).toBeGreaterThanOrEqual(300);
  });

  test('budget 0 is a single check', async () => {
    const w = world({ 7: {} });
    expect(await waitForDeath(7, { budgetMs: 0, ...w })).toBe(false);
    expect(w.now()).toBe(0);
  });

  test('true when the pid dies mid-budget', async () => {
    const w = world({ 7: {} });
    const sleep = async (ms) => {
      await w.sleep(ms);
      if (w.now() >= 200) w.table.get(7).alive = false;
    };
    expect(await waitForDeath(7, { budgetMs: 1000, pollMs: 100, ...w, sleep })).toBe(true);
  });
});

describe('terminate', () => {
  test('SIGTERM suffices: no SIGKILL is sent', async () => {
    const w = world({ 9: { diesOn: ['SIGTERM'] } });
    expect(await terminate(9, { ...w })).toBe('dead');
    expect(w.sent).toEqual([[-9, 'SIGTERM']]);
  });

  test('ignores SIGTERM: SIGKILL after the grace', async () => {
    const w = world({ 9: { diesOn: ['SIGKILL'] } });
    expect(await terminate(9, { graceMs: 2000, ...w })).toBe('dead');
    expect(w.sent).toEqual([[-9, 'SIGTERM'], [-9, 'SIGKILL']]);
    expect(w.now()).toBeGreaterThanOrEqual(2000);
  });

  test('survives both signals: survived', async () => {
    const w = world({ 9: { diesOn: [] } });
    expect(await terminate(9, { ...w })).toBe('survived');
  });

  test('already gone (ESRCH, pid dead): dead, without waiting', async () => {
    const w = world({ 9: { alive: false } });
    expect(await terminate(9, { ...w })).toBe('dead');
    expect(w.now()).toBe(0);
  });

  test('ESRCH on the group while the pid lives is not death', async () => {
    const w = world({ 9: { notLeader: true, diesOn: ['SIGTERM'] } });
    expect(await terminate(9, { group: true, ...w })).toBe('survived');
  });

  test('EPERM: survived, no SIGKILL attempted', async () => {
    const w = world({ 9: { eperm: true } });
    expect(await terminate(9, { ...w })).toBe('survived');
    expect(w.sent).toEqual([[-9, 'SIGTERM']]);
  });

  test('group:false signals the pid, not the group', async () => {
    const w = world({ 9: { notLeader: true, diesOn: ['SIGTERM'] } });
    expect(await terminate(9, { group: false, ...w })).toBe('dead');
    expect(w.sent).toEqual([[9, 'SIGTERM']]);
  });

  test('rejects a non-positive pid instead of signalling a whole session', async () => {
    const w = world({});
    await expect(terminate(0, { ...w })).rejects.toThrow(TypeError);
    await expect(terminate(-5, { ...w })).rejects.toThrow(TypeError);
    expect(w.sent).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx jest tests/unit/device/process-reaper.test.js`
Expected: FAIL — `Cannot find module '../../../src/device/process-reaper'`.

- [ ] **Step 3: Implement the module**

`src/device/process-reaper.js`:

```js
'use strict';

// Process termination for the device session lifecycle (#156). Two callers:
// session-spawn.js kills a daemon that never became ready, and `session end`
// (connection.js) escalates a daemon stuck in teardown.
//
// Mechanism only. This module never decides WHOSE pid it is signalling — the
// spawner holds its own ChildProcess, and `session end` runs pidIdentity first.
// Every effect (kill, liveness, clock) is injected so the escalation policy is
// tested once, here, against a fake process table.

const { pidAlive } = require('./session-daemon');

// Deliberately NOT unref'd: `session end` is a one-shot verb process with
// nothing else on its event loop while it waits, so an unref'd timer would let
// the process exit mid-wait and report nothing.
function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Resolves true as soon as `pid` is dead, false once `budgetMs` has elapsed.
// budgetMs 0 is a single check.
async function waitForDeath(
  pid,
  { budgetMs, pollMs = 100, isAlive = pidAlive, sleep = defaultSleep, now = Date.now } = {}
) {
  const deadline = now() + budgetMs;
  for (;;) {
    if (!isAlive(pid)) return true;
    const left = deadline - now();
    if (left <= 0) return false;
    await sleep(Math.min(pollMs, left));
  }
}

// One signal. 'denied' (EPERM) means a process we may not signal, which is not
// ours to report as killed. ESRCH is NOT trusted as death: for a group kill it
// can mean "no such group" while the pid itself is alive, so the caller always
// confirms with isAlive.
function send(kill, target, sig) {
  try {
    kill(target, sig);
    return 'sent';
  } catch (err) {
    if (err && err.code === 'EPERM') return 'denied';
    if (err && err.code === 'ESRCH') return 'gone';
    throw err;
  }
}

// SIGTERM, wait up to graceMs, SIGKILL, wait up to graceMs, report.
//
// group:true signals -pid, the process GROUP. That only works for a group
// leader: the daemon is one because session-spawn.js spawns it with
// `detached: true`, which is also what makes -pid reach the mobile-mcp engine
// and its mobilecli (spawned non-detached, so in the daemon's group). Remove
// `detached` there and -pid becomes ESRCH — reported here as 'survived', never
// as a false 'dead'. group:false is for the engine child, which leads no group.
async function terminate(
  pid,
  {
    group = true,
    graceMs = 2000,
    pollMs = 50,
    kill = process.kill.bind(process),
    isAlive = pidAlive,
    sleep = defaultSleep,
    now = Date.now,
  } = {}
) {
  // kill(0) / kill(-1) / a negative pid would signal our own group or every
  // process we own. Refuse rather than guess.
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new TypeError(`terminate requires a positive integer pid, got ${pid}`);
  }
  const target = group ? -pid : pid;
  for (const sig of ['SIGTERM', 'SIGKILL']) {
    if (send(kill, target, sig) === 'denied') return isAlive(pid) ? 'survived' : 'dead';
    if (await waitForDeath(pid, { budgetMs: graceMs, pollMs, isAlive, sleep, now })) return 'dead';
  }
  return 'survived';
}

module.exports = { waitForDeath, terminate };
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `npx jest tests/unit/device/process-reaper.test.js`
Expected: PASS (12 tests).

Note on "already gone": `send` returns `'gone'`, then `waitForDeath` sees the dead pid on its first check and returns before sleeping, so `now()` stays 0.

- [ ] **Step 5: Write the real-process integration test**

`tests/integration/process-reaper.test.js`:

```js
'use strict';

// The fake process table cannot show that -pid reaches a GRANDCHILD — the
// mobile-mcp engine under a daemon. This spawns a real detached leader with a
// real child of its own and kills the group.

const { spawn } = require('child_process');
const { terminate, waitForDeath } = require('../../src/device/process-reaper');
const { pidAlive } = require('../../src/device/session-daemon');

jest.setTimeout(15000);

// Leader prints its child's pid, then both idle forever.
const LEADER = `
  const { spawn } = require('child_process');
  const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  process.stdout.write(String(c.pid) + '\\n');
  setInterval(() => {}, 1000);
`;

function startTree() {
  return new Promise((resolve, reject) => {
    const leader = spawn(process.execPath, ['-e', LEADER], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
    leader.on('error', reject);
    leader.stdout.once('data', (buf) => resolve({ leader, childPid: Number(String(buf).trim()) }));
  });
}

test('terminate(group) kills the leader and its child', async () => {
  const { leader, childPid } = await startTree();
  expect(pidAlive(leader.pid)).toBe(true);
  expect(pidAlive(childPid)).toBe(true);

  expect(await terminate(leader.pid, { group: true, graceMs: 2000 })).toBe('dead');
  // The orphaned child is reparented and reaped by init; give it a moment.
  expect(await waitForDeath(childPid, { budgetMs: 3000 })).toBe(true);
});

test('terminate(group:false) kills only the pid', async () => {
  const { leader, childPid } = await startTree();
  try {
    expect(await terminate(childPid, { group: false, graceMs: 2000 })).toBe('dead');
    expect(pidAlive(leader.pid)).toBe(true);
  } finally {
    await terminate(leader.pid, { group: true });
  }
});
```

- [ ] **Step 6: Run it**

Run: `npx jest tests/integration/process-reaper.test.js`
Expected: PASS (2 tests).

- [ ] **Step 7: Bump the version and open the changelog section**

Run: `npm version 0.28.0 --no-git-tag-version`
Expected: `v0.28.0`; `git diff --stat` shows `package.json` and `package-lock.json`.

In `CHANGELOG.md`, insert above `## [0.27.1]` (keep the existing `---` separators consistent with neighbouring sections):

```markdown
## [0.28.0]

**Device session lifecycle honesty (#156).** The session daemon no longer
hangs on a wedged engine, leaves an unready daemon holding the workspace lock,
reports `session end` as stopped before it is, or keeps serving after its
engine has died.

---

```

- [ ] **Step 8: Run the guards this step can break**

Run: `npx jest tests/lint`
Expected: PASS (includes the CHANGELOG heading guard).

- [ ] **Step 9: Commit**

```bash
cd /Users/mohamedshalan/orca/workspaces/mobile-automator/bug-daemon-lifecycle-unbounded-mobile-mcp-connec
git branch --show-current   # must print fix/156-daemon-lifecycle
git add src/device/process-reaper.js tests/unit/device/process-reaper.test.js tests/integration/process-reaper.test.js package.json package-lock.json CHANGELOG.md
git commit -m "feat(device): process reaper for daemon termination (#156)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 10: Push and open the draft PR**

```bash
git push -u origin fix/156-daemon-lifecycle
gh pr create --draft --base main --title "fix(device): daemon lifecycle honesty (#156)" --body "$(cat <<'EOF'
## What

Closes the three remaining lifecycle gaps from #156 plus the dead-engine status gap:

- bounded mobile-mcp connect (10s, below the 15s spawn readiness window)
- a spawn readiness timeout kills its own unready daemon's process group
- `session end` waits for the daemon to actually exit and escalates a stuck one
- the daemon reaps itself when its engine dies; `session status` says why

Design: `docs/plans/2026-10-15-daemon-lifecycle-156-design.md` · Plan: `docs/plans/2026-10-16-daemon-lifecycle-156-plan.md`

## Test plan

- [ ] `npm test`
- [ ] `npm run lint:guides`
- [ ] `npm run lint:schema-additive`
- [ ] `./scripts/pack-smoke.sh`

Closes #156
Refs #168

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

### Task 2: Bounded connect + engine-exit signal in `createCall`

**Files:**
- Modify: `src/device/mobile-mcp-client.js:29-64` (createCall) and `:165` (exports)
- Modify: `src/device/session-spawn.js:92` (export `DEFAULT_READY_TIMEOUT_MS`)
- Create: `tests/fixtures/mcp-fixture-server.js`
- Create: `tests/unit/device/mobile-mcp-client-lifecycle.test.js`
- Create: `tests/integration/engine-lifecycle.test.js`
- Modify: `tests/unit/device/timeout-invariant.test.js`

**Interfaces:**
- Consumes: `waitForDeath`, `terminate` from Task 1.
- Produces:
  - `createCall({ device, connectTimeoutMs = CONNECT_TIMEOUT_MS, onEngineExit = null, sdk = { Client, StdioClientTransport }, server = null, reaper = require('./process-reaper') }) → Promise<{ call, close }>`
  - `onEngineExit()` — called at most once, never after our own `close()` or a failed connect.
  - Connect timeout error: `Error` with `.code === 'ENGINE_CONNECT_TIMEOUT'`, message `mobile-mcp did not finish initializing within <n>ms`, `.cause` = the SDK error.
  - Exports `CONNECT_TIMEOUT_MS` (10000) from `mobile-mcp-client.js`; `DEFAULT_READY_TIMEOUT_MS` (15000) from `session-spawn.js`.

- [ ] **Step 1: Write the failing unit tests (fake SDK)**

`tests/unit/device/mobile-mcp-client-lifecycle.test.js`:

```js
'use strict';

const { McpError, ErrorCode } = require('@modelcontextprotocol/sdk/types.js');
const { createCall, CONNECT_TIMEOUT_MS } = require('../../../src/device/mobile-mcp-client');

// Fake SDK. The fake Client mirrors the real one where it matters: connect()
// calls transport.start(), honours options.timeout by rejecting with
// McpError(RequestTimeout), and runs its own close() on failure — which, like
// the real StdioClientTransport, clears the pid before the child is gone.
function fakeSdk({ connect = 'ok', pid = 4321 } = {}) {
  const made = {};
  class StdioClientTransport {
    constructor(params) {
      this.params = params;
      this._pid = null;
      this.closed = 0;
      made.transport = this;
    }
    async start() {
      this._pid = pid;
    }
    get pid() {
      return this._pid;
    }
    async close() {
      this._pid = null;
      this.closed += 1;
    }
  }
  class Client {
    constructor() {
      this.onclose = undefined;
      made.client = this;
    }
    async connect(transport, options) {
      made.connectOptions = options;
      this.transport = transport;
      await transport.start();
      if (connect === 'timeout') {
        void transport.close();
        throw new McpError(ErrorCode.RequestTimeout, 'Request timed out');
      }
      if (connect === 'boom') {
        void transport.close();
        throw new Error('spawn ENOENT');
      }
    }
    async close() {
      await this.transport.close();
      if (this.onclose) this.onclose();
    }
    async callTool() {
      return { content: [{ type: 'text', text: '{"ok":1}' }] };
    }
  }
  return { sdk: { Client, StdioClientTransport }, made };
}

function fakeReaper({ dies = true } = {}) {
  const calls = [];
  return {
    calls,
    waitForDeath: async (pid, opts) => {
      calls.push(['waitForDeath', pid, opts]);
      return dies;
    },
    terminate: async (pid, opts) => {
      calls.push(['terminate', pid, opts]);
      return 'dead';
    },
  };
}

const server = { command: 'fake-node', args: ['fake-entry.js'] };

describe('createCall lifecycle (#156)', () => {
  test('forwards the connect timeout to client.connect', async () => {
    const { sdk, made } = fakeSdk();
    await createCall({ sdk, server, connectTimeoutMs: 1234, reaper: fakeReaper() });
    expect(made.connectOptions).toEqual({ timeout: 1234 });
  });

  test('defaults the connect timeout to CONNECT_TIMEOUT_MS', async () => {
    const { sdk, made } = fakeSdk();
    await createCall({ sdk, server, reaper: fakeReaper() });
    expect(made.connectOptions).toEqual({ timeout: CONNECT_TIMEOUT_MS });
    expect(CONNECT_TIMEOUT_MS).toBe(10000);
  });

  test('a connect timeout throws ENGINE_CONNECT_TIMEOUT naming the bound', async () => {
    const { sdk } = fakeSdk({ connect: 'timeout' });
    const err = await createCall({ sdk, server, connectTimeoutMs: 500, reaper: fakeReaper() }).catch((e) => e);
    expect(err.code).toBe('ENGINE_CONNECT_TIMEOUT');
    expect(err.message).toBe('mobile-mcp did not finish initializing within 500ms');
    expect(err.cause).toBeInstanceOf(McpError);
  });

  test('a failed connect waits for the engine pid captured at start, before throwing', async () => {
    const { sdk } = fakeSdk({ connect: 'timeout', pid: 777 });
    const reaper = fakeReaper({ dies: true });
    await createCall({ sdk, server, reaper }).catch(() => {});
    expect(reaper.calls).toEqual([['waitForDeath', 777, { budgetMs: 5000 }]]);
  });

  test('an engine that outlives the reap budget is terminated by pid, not group', async () => {
    const { sdk } = fakeSdk({ connect: 'timeout', pid: 777 });
    const reaper = fakeReaper({ dies: false });
    await createCall({ sdk, server, reaper }).catch(() => {});
    expect(reaper.calls[1]).toEqual(['terminate', 777, { group: false, graceMs: 1000 }]);
  });

  test('a non-timeout connect error passes through unchanged', async () => {
    const { sdk } = fakeSdk({ connect: 'boom' });
    const err = await createCall({ sdk, server, reaper: fakeReaper() }).catch((e) => e);
    expect(err.message).toBe('spawn ENOENT');
    expect(err.code).toBeUndefined();
  });

  test('an engine exit after connect calls onEngineExit exactly once', async () => {
    const { sdk, made } = fakeSdk();
    const onEngineExit = jest.fn();
    await createCall({ sdk, server, onEngineExit, reaper: fakeReaper() });
    made.client.onclose();
    made.client.onclose();
    expect(onEngineExit).toHaveBeenCalledTimes(1);
  });

  test('our own close() never reports an engine exit', async () => {
    const { sdk } = fakeSdk();
    const onEngineExit = jest.fn();
    const { close } = await createCall({ sdk, server, onEngineExit, reaper: fakeReaper() });
    await close();
    expect(onEngineExit).not.toHaveBeenCalled();
  });

  test('a failed connect never reports an engine exit', async () => {
    const { sdk, made } = fakeSdk({ connect: 'timeout' });
    const onEngineExit = jest.fn();
    await createCall({ sdk, server, onEngineExit, reaper: fakeReaper() }).catch(() => {});
    if (made.client.onclose) made.client.onclose();
    expect(onEngineExit).not.toHaveBeenCalled();
  });

  test('the injected server command reaches the transport', async () => {
    const { sdk, made } = fakeSdk();
    await createCall({ sdk, server, reaper: fakeReaper() });
    expect(made.transport.params.command).toBe('fake-node');
    expect(made.transport.params.args).toEqual(['fake-entry.js']);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx jest tests/unit/device/mobile-mcp-client-lifecycle.test.js`
Expected: FAIL — `CONNECT_TIMEOUT_MS` undefined / `connectOptions` undefined.

- [ ] **Step 3: Implement**

In `src/device/mobile-mcp-client.js`, add after the `require` block:

```js
const { ErrorCode } = require('@modelcontextprotocol/sdk/types.js');

// Bound on mobile-mcp's MCP initialize handshake (#156). Measured at ~200ms on
// mobile-mcp 1.0.5 — initialize touches no device — so 10s is ~50x headroom.
// It MUST stay below session-spawn's DEFAULT_READY_TIMEOUT_MS: the spawner
// kills an unready daemon when its window closes, so a longer connect bound
// would have the daemon killed instead of failing with its own
// daemon.connect_failure. Pinned by tests/unit/device/timeout-invariant.test.js.
// (The SDK's own default is 60s, which is longer than the window watching it.)
const CONNECT_TIMEOUT_MS = 10000;

// How long a failed connect waits for the engine child to exit before
// escalating. Covers the SDK's own close ladder: stdin end → 2s → SIGTERM → 2s.
const ENGINE_REAP_BUDGET_MS = 5000;
```

Replace the whole `createCall` function (currently lines 29-64) with:

```js
// Integration glue: spawns mobile-mcp over stdio and returns a `call`
// function shaped exactly like the one DeviceBridge expects.
//
// `sdk`, `server` and `reaper` are test seams: production passes none of them.
// tests/unit/device/mobile-mcp-client-lifecycle.test.js drives this against a
// fake SDK; tests/integration/engine-lifecycle.test.js against the real SDK and
// a fixture MCP server.
async function createCall({
  device,
  connectTimeoutMs = CONNECT_TIMEOUT_MS,
  onEngineExit = null,
  sdk = { Client, StdioClientTransport },
  server = null,
  reaper = require('./process-reaper'),
} = {}) {
  // Resolved lazily, here, so the module still loads without mobile-mcp installed.
  const { command, args } = server || { command: process.execPath, args: [resolveServerEntry()] };
  const transport = new sdk.StdioClientTransport({
    command,
    args,
    // mobile-mcp reads the target device from the environment / its own
    // selection; we pass it through when provided so callers can pin a device.
    env: device ? { ...process.env, MOBILE_MCP_DEVICE: device } : process.env,
  });

  // The engine pid, captured the moment the child is spawned. It has to be
  // captured HERE: on a failed connect the SDK runs `void this.close()`, and
  // StdioClientTransport.close() clears its pid synchronously — so by the time
  // our catch runs, transport.pid is already null while the child may still be
  // alive. Client.connect() awaits transport.start(), so wrapping the instance
  // method is enough.
  let enginePid = null;
  const start = transport.start.bind(transport);
  transport.start = async () => {
    await start();
    enginePid = transport.pid;
  };

  const client = new sdk.Client({ name: 'mauto', version: '0.1.0' }, { capabilities: {} });

  // Engine liveness (#156). The SDK fires onclose on EVERY child close — a real
  // engine death and our own close() alike — so `closing` separates the two.
  // A failed connect also sets it: that failure is reported by the throw.
  let closing = false;
  let reported = false;
  client.onclose = () => {
    if (closing || reported) return;
    reported = true;
    if (typeof onEngineExit === 'function') onEngineExit();
  };

  try {
    await client.connect(transport, { timeout: connectTimeoutMs });
  } catch (err) {
    closing = true;
    await reapEngine(enginePid, reaper);
    throw connectError(err, connectTimeoutMs);
  }

  async function rawCall(toolName, args = {}) {
    const res = await client.callTool({ name: toolName, arguments: args });
    return parseToolResult(res);
  }
  const { call } = makeCall({ rawCall, device });

  async function close() {
    closing = true;
    try {
      await client.close();
    } catch (_e) {
      // best-effort teardown
    }
  }

  return { call, close };
}

// The SDK's connect-failure cleanup is fire-and-forget, so wait for the engine
// to actually exit (and escalate if it will not) before the error leaves
// createCall — nothing may outlive the failure it reports. group:false: the
// engine is not a process-group leader.
async function reapEngine(pid, reaper) {
  if (!pid) return;
  if (await reaper.waitForDeath(pid, { budgetMs: ENGINE_REAP_BUDGET_MS })) return;
  await reaper.terminate(pid, { group: false, graceMs: 1000 });
}

// A timed-out initialize becomes an error that names the bound; anything else
// (spawn ENOENT, a protocol mismatch) passes through untouched.
function connectError(err, timeoutMs) {
  if (!(err && err.code === ErrorCode.RequestTimeout)) return err;
  const e = new Error(`mobile-mcp did not finish initializing within ${timeoutMs}ms`);
  e.code = 'ENGINE_CONNECT_TIMEOUT';
  e.cause = err;
  return e;
}
```

Change the export line (currently line 165) to:

```js
module.exports = { createCall, makeCall, parseToolResult, resolveServerEntry, CONNECT_TIMEOUT_MS };
```

In `src/device/session-spawn.js`, change the last line to:

```js
module.exports = { spawnDaemon, DAEMON_BIN, DEFAULT_READY_TIMEOUT_MS };
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `npx jest tests/unit/device/mobile-mcp-client-lifecycle.test.js tests/unit/device/mobile-mcp-client-inject.test.js tests/unit/device/mobile-mcp-client.smoke.test.js`
Expected: PASS.

- [ ] **Step 5: Add the timeout-ladder rung**

Append to `tests/unit/device/timeout-invariant.test.js`:

```js
// #156: the spawner kills a daemon that is not ready when its window closes, so
// the engine connect bound must expire first — otherwise a slow-but-healthy
// connect is killed instead of failing honestly with daemon.connect_failure.
describe('connect/readiness timeout invariant (#156)', () => {
  test('CONNECT_TIMEOUT < DEFAULT_READY_TIMEOUT', () => {
    const { CONNECT_TIMEOUT_MS } = require('../../../src/device/mobile-mcp-client');
    const { DEFAULT_READY_TIMEOUT_MS } = require('../../../src/device/session-spawn');
    expect(CONNECT_TIMEOUT_MS).toBeLessThan(DEFAULT_READY_TIMEOUT_MS);
  });
});
```

Run: `npx jest tests/unit/device/timeout-invariant.test.js`
Expected: PASS (2 tests).

- [ ] **Step 6: Write the fixture server**

`tests/fixtures/mcp-fixture-server.js`:

```js
#!/usr/bin/env node
'use strict';

// A minimal MCP server for tests/integration/engine-lifecycle.test.js, so the
// REAL SDK client path in createCall is exercised without mobile-mcp or a device.
//
//   never-init       reads stdin, never answers initialize, ignores stdin EOF
//                    (forces the SDK's SIGTERM step)
//   exit-after-init  completes the handshake, then exits — an engine death
//   stay-up          completes the handshake and stays up until closed

const mode = process.argv[2];

if (mode === 'never-init') {
  process.stdin.resume();
  setInterval(() => {}, 1000);
} else {
  const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
  const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
  const server = new Server({ name: 'mauto-fixture', version: '0.0.0' }, { capabilities: {} });
  if (mode === 'exit-after-init') {
    server.oninitialized = () => setTimeout(() => process.exit(0), 50);
  }
  server.connect(new StdioServerTransport());
}
```

- [ ] **Step 7: Write the integration test**

`tests/integration/engine-lifecycle.test.js`:

```js
'use strict';

// createCall against the REAL MCP SDK and a fixture server. The unit tests use
// a fake SDK, which can only behave the way we believe the SDK behaves; this
// file is what shows the timeout option and onclose actually do that.

const path = require('path');
const { createCall } = require('../../src/device/mobile-mcp-client');

jest.setTimeout(15000);

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'mcp-fixture-server.js');
const server = (mode) => ({ command: process.execPath, args: [FIXTURE, mode] });

test('a server that never initializes fails with ENGINE_CONNECT_TIMEOUT, and is gone', async () => {
  const started = Date.now();
  const err = await createCall({ server: server('never-init'), connectTimeoutMs: 500 }).catch((e) => e);
  expect(err.code).toBe('ENGINE_CONNECT_TIMEOUT');
  // Bounded: the timeout plus the SDK's close ladder, never the 60s SDK default.
  expect(Date.now() - started).toBeLessThan(8000);
  // createCall only returns after reapEngine confirmed the child is dead; the
  // fixture ignores stdin EOF, so this proves the escalation really happened.
});

test('an engine that exits after initialize fires onEngineExit once', async () => {
  const exits = [];
  await createCall({ server: server('exit-after-init'), onEngineExit: () => exits.push(Date.now()) });
  const deadline = Date.now() + 5000;
  while (exits.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
  expect(exits).toHaveLength(1);
});

test('our own close() does not fire onEngineExit', async () => {
  const exits = [];
  const { close } = await createCall({ server: server('stay-up'), onEngineExit: () => exits.push(1) });
  await close();
  await new Promise((r) => setTimeout(r, 200));
  expect(exits).toHaveLength(0);
});
```

- [ ] **Step 8: Run it**

Run: `npx jest tests/integration/engine-lifecycle.test.js`
Expected: PASS (3 tests). If the first test fails with a raw `McpError` instead of `ENGINE_CONNECT_TIMEOUT`, print `err.code` — the SDK must report `-32001` (`ErrorCode.RequestTimeout`, `node_modules/@modelcontextprotocol/sdk/dist/cjs/types.js:197`).

- [ ] **Step 9: Run the device suite**

Run: `npx jest tests/unit/device tests/integration`
Expected: PASS. `tests/integration/mobile-mcp-contract.test.js` builds its own client and is unaffected.

- [ ] **Step 10: Commit**

```bash
cd /Users/mohamedshalan/orca/workspaces/mobile-automator/bug-daemon-lifecycle-unbounded-mobile-mcp-connec
git branch --show-current   # must print fix/156-daemon-lifecycle
git add src/device/mobile-mcp-client.js src/device/session-spawn.js tests/fixtures/mcp-fixture-server.js tests/unit/device/mobile-mcp-client-lifecycle.test.js tests/integration/engine-lifecycle.test.js tests/unit/device/timeout-invariant.test.js
git commit -m "fix(device): bound the mobile-mcp connect and signal engine exit (#156)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Spawn kill on readiness timeout

**Files:**
- Modify: `src/device/session-spawn.js:25-90`
- Modify: `tests/unit/device/session-spawn.test.js`
- Modify: `tests/unit/device/daemon-pid-identity.test.js`

**Interfaces:**
- Consumes: `terminate(pid, { group: true })` from Task 1.
- Produces: `spawnDaemon({ ..., terminate = (pid) => reaper.terminate(pid, { group: true }) })` — return value unchanged (`true` ready / `false` not).

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('session-spawn', ...)` block of `tests/unit/device/session-spawn.test.js`:

```js
  // #156: a running ChildProcess has exitCode === null AND signalCode === null.
  // The existing fakeChild() leaves both undefined, i.e. "not a live child".
  function liveChild(pid = 5151) {
    return { ...fakeChild(pid), exitCode: null, signalCode: null };
  }

  test('readiness timeout terminates the live child and logs it', async () => {
    const log = fakeLog();
    const terminated = [];
    const ok = await spawnDaemon({
      projectRoot: '/proj',
      spawn: () => liveChild(5151),
      openLog: () => log,
      isAlive: async () => false,
      terminate: async (pid) => { terminated.push(pid); return 'dead'; },
      pollMs: 5,
      readyTimeoutMs: 30,
    });
    expect(ok).toBe(false);
    expect(terminated).toEqual([5151]);
    expect(log.writes.join('')).toContain('daemon not ready after 30ms; terminated pid=5151 (dead)');
    expect(log.closes).toBe(1);
  });

  test('readiness timeout leaves an already-exited child alone (ELOCKED loser)', async () => {
    const terminated = [];
    const ok = await spawnDaemon({
      projectRoot: '/proj',
      spawn: () => ({ ...fakeChild(5152), exitCode: 1, signalCode: null }),
      openLog: () => fakeLog(),
      isAlive: async () => false,
      terminate: async (pid) => { terminated.push(pid); return 'dead'; },
      pollMs: 5,
      readyTimeoutMs: 30,
    });
    expect(ok).toBe(false);
    expect(terminated).toEqual([]);
  });

  test('a spawn error never terminates anything', async () => {
    const terminated = [];
    const child = Object.assign(new EventEmitter(), liveChild(5153));
    const ok = await spawnDaemon({
      projectRoot: '/proj',
      spawn: () => {
        setImmediate(() => child.emit('error', new Error('EACCES')));
        return child;
      },
      openLog: () => fakeLog(),
      isAlive: async () => false,
      terminate: async (pid) => { terminated.push(pid); return 'dead'; },
      pollMs: 5,
      readyTimeoutMs: 200,
    });
    expect(ok).toBe(false);
    expect(terminated).toEqual([]);
  });

  test('a ready daemon is never terminated', async () => {
    const terminated = [];
    const ok = await spawnDaemon({
      projectRoot: '/proj',
      spawn: () => liveChild(5154),
      openLog: () => fakeLog(),
      isAlive: async () => true,
      terminate: async (pid) => { terminated.push(pid); return 'dead'; },
      pollMs: 1,
    });
    expect(ok).toBe(true);
    expect(terminated).toEqual([]);
  });
```

Append to `tests/unit/device/daemon-pid-identity.test.js` (at file end, outside other `describe`s; add any missing `require`s at the top of the file — `fs`, `os`, `path`, `child_process`, `startDaemon`, `paths` — reusing the file's existing ones where present):

```js
// #156: a daemon SIGTERMed during createCall has no handler installed yet, so it
// dies without its 'exit' cleanup and leaves its lock behind. The next start
// must treat that lock as stale (dead pid), not as a held lock.
describe('stale lock from a daemon killed mid-startup (#156)', () => {
  test('a lock left by a dead daemon does not block the next start', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-deadlock-'));
    fs.mkdirSync(paths.sessionDir(root), { recursive: true });
    const dead = require('child_process').spawnSync(process.execPath, ['-e', '']).pid;
    fs.writeFileSync(paths.lockPath(root), `${dead}\n`);

    const daemon = await startDaemon({
      projectRoot: root,
      createCall: async () => ({ call: async () => ({}), close: async () => {} }),
    });
    expect(fs.readFileSync(paths.lockPath(root), 'utf8').trim()).toBe(String(process.pid));
    await daemon.stop();
  });
});
```

- [ ] **Step 2: Run them to verify the spawn ones fail**

Run: `npx jest tests/unit/device/session-spawn.test.js tests/unit/device/daemon-pid-identity.test.js`
Expected: FAIL — "readiness timeout terminates the live child" (`terminated` is `[]`). The stale-lock test should already PASS (existing `cleanStale` behaviour, now pinned); if it fails, stop and report — that is a real bug outside this plan.

- [ ] **Step 3: Implement**

In `src/device/session-spawn.js`, add after `const sessionLog = require('./session-log');`:

```js
const reaper = require('./process-reaper');
```

Add the parameter to `spawnDaemon`'s destructuring, after `openLog = sessionLog.openDaemonLog,`:

```js
  // Kills a daemon that never became ready (#156). group:true reaches the
  // daemon AND its mobile-mcp engine: `detached: true` below makes the daemon
  // a process-group leader, and the engine is spawned into its group.
  terminate = (pid) => reaper.terminate(pid, { group: true }),
```

Replace the readiness loop's tail (currently):

```js
    const deadline = Date.now() + readyTimeoutMs;
    while (Date.now() < deadline) {
      if (spawnError) return false;
      if (await isAlive(projectRoot)) return true;
      await sleep(pollMs);
    }
    return false;
```

with:

```js
    const deadline = Date.now() + readyTimeoutMs;
    while (Date.now() < deadline) {
      if (spawnError) return false;
      if (await isAlive(projectRoot)) return true;
      await sleep(pollMs);
    }

    // Not ready in time. Without this the child lives on — typically still
    // inside createCall, holding the O_EXCL lock — and every later verb burns
    // its own readiness window against it (#156). Only OUR child, and only if
    // it is still running: an ELOCKED spawn-race loser has already exited and
    // must never signal anything. Node tracked this exact child, so its state
    // needs no pidIdentity check and has no pid-reuse window.
    if (child && child.pid && child.exitCode === null && child.signalCode === null) {
      const outcome = await terminate(child.pid);
      // The parent is the only witness to this kill — write it down (#163).
      log.write(`mauto: daemon not ready after ${readyTimeoutMs}ms; terminated pid=${child.pid} (${outcome})\n`);
    }
    return false;
```

`child` is declared with `const` inside the `try` block above the loop, so it is in scope. `log.close()` stays in the existing `finally`, which runs after this.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/unit/device/session-spawn.test.js tests/unit/device/daemon-pid-identity.test.js tests/unit/device/resolve-connection.test.js`
Expected: PASS. The pre-existing "resolves false on readiness timeout" test uses `fakeChild()` (no `exitCode`), so it does not reach `terminate` — and so never signals a real pid 4242.

- [ ] **Step 5: Commit**

```bash
cd /Users/mohamedshalan/orca/workspaces/mobile-automator/bug-daemon-lifecycle-unbounded-mobile-mcp-connec
git branch --show-current   # must print fix/156-daemon-lifecycle
git add src/device/session-spawn.js tests/unit/device/session-spawn.test.js tests/unit/device/daemon-pid-identity.test.js
git commit -m "fix(device): kill an unready daemon's process group on spawn timeout (#156)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Daemon self-reap on engine death + vocabulary

**Files:**
- Modify: `src/device/session-daemon.js` (createCall call ~`:304`; after the listen `try/catch` ~`:683`; ping ~`:602`)
- Modify: `src/observe/vocab.js:45,88-94`
- Modify: `src/observe/event.js:123,126`
- Modify: `tests/lint/telemetry-vocab-drift.test.js:119,121`
- Modify: `docs/reference/telemetry.md:80-81`
- Create: `tests/unit/device/daemon-engine-exit.test.js`

**Interfaces:**
- Consumes: `createCall({ device, onEngineExit })` contract from Task 2 (the daemon passes `onEngineExit`; injected stubs may ignore it).
- Produces:
  - Ping reply `result: { pong: true, device, in_flight, engine_alive: boolean }`.
  - `startDaemon` rejects with `.code === 'ENGINE_EXITED'` when the engine died before the daemon was serving; no handle/pidfile written.
  - Events: `daemon.engine_exit` (level `error`), `daemon.stop` with `stop_reason: 'engine_exit'`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/device/daemon-engine-exit.test.js`:

```js
'use strict';

// #156: the daemon reaps itself when its engine dies, instead of living on as
// a zombie that answers ping and can never serve a call.

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const { startDaemon } = require('../../../src/device/session-daemon');
const sessionClient = require('../../../src/device/session-client');
const paths = require('../../../src/device/session-paths');
const { FrameParser } = require('../../../src/device/session-protocol');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-engine-exit-'));
}

function collector() {
  const events = [];
  const observe = (fields) => events.push(fields);
  observe.events = events;
  observe.names = () => events.map((e) => e.event);
  return observe;
}

// Stub engine: captures onEngineExit; `gate` lets a call hang until released.
function engineStub({ exitDuringConnect = false } = {}) {
  const s = { exit: null, closed: 0, release: null };
  const createCall = async ({ onEngineExit } = {}) => {
    s.exit = onEngineExit;
    if (exitDuringConnect) onEngineExit();
    return {
      call: async (tool) => {
        if (tool === 'hang') {
          await new Promise((_, reject) => { s.release = reject; });
        }
        return { tool };
      },
      close: async () => { s.closed += 1; },
    };
  };
  return { createCall, s };
}

function rawPing(root) {
  return new Promise((resolve, reject) => {
    const parser = new FrameParser();
    const sock = net.createConnection(paths.socketPath(root));
    sock.setEncoding('utf8');
    sock.on('error', reject);
    sock.on('connect', () => sock.write(FrameParser.encode({ id: 1, type: 'ping' })));
    sock.on('data', (chunk) => {
      for (const f of parser.push(chunk)) {
        if (f.value && f.value.id === 1) { sock.end(); resolve(f.value); }
      }
    });
  });
}

const gone = (root) =>
  [paths.lockPath(root), paths.pidFilePath(root), paths.handlePath(root)].filter((p) => fs.existsSync(p));

describe('daemon engine exit (#156)', () => {
  test('ping reports engine_alive:true while the engine is up', async () => {
    const root = tmpRoot();
    const { createCall } = engineStub();
    const daemon = await startDaemon({ projectRoot: root, createCall });
    const res = await rawPing(root);
    expect(res.result.engine_alive).toBe(true);
    await daemon.stop();
  });

  test('an engine exit stops the daemon, frees its files, and is recorded first', async () => {
    const root = tmpRoot();
    const obs = collector();
    const { createCall, s } = engineStub();
    const daemon = await startDaemon({ projectRoot: root, createCall, recorderFor: () => obs });

    s.exit();
    await daemon.whenStopped;

    expect(gone(root)).toEqual([]);
    const names = obs.names();
    expect(names).toContain('daemon.engine_exit');
    expect(names.indexOf('daemon.engine_exit')).toBeLessThan(names.indexOf('daemon.stop'));
    expect(obs.events.find((e) => e.event === 'daemon.engine_exit').level).toBe('error');
    expect(obs.events.find((e) => e.event === 'daemon.stop').stop_reason).toBe('engine_exit');
  });

  test('an in-flight call gets its error reply before teardown; ping during the drain says engine_alive:false', async () => {
    const root = tmpRoot();
    const { createCall, s } = engineStub();
    const daemon = await startDaemon({ projectRoot: root, createCall });

    const conn = await sessionClient.tryConnect(root);
    const pending = conn.call('hang', {}).catch((e) => e);
    while (!s.release) await new Promise((r) => setTimeout(r, 5));

    s.exit(); // stop() now drains the hung call
    const ping = await rawPing(root);
    expect(ping.result.engine_alive).toBe(false);

    s.release(new Error('Connection closed')); // what the SDK does to pending calls
    const err = await pending;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('Connection closed');

    await daemon.whenStopped;
    await conn.close();
  });

  test('an engine that dies before the daemon is serving fails the start and writes no handle', async () => {
    const root = tmpRoot();
    const obs = collector();
    const { createCall, s } = engineStub({ exitDuringConnect: true });
    const err = await startDaemon({ projectRoot: root, createCall, recorderFor: () => obs }).catch((e) => e);

    expect(err.code).toBe('ENGINE_EXITED');
    expect(gone(root)).toEqual([]);
    expect(s.closed).toBe(1);
    const failure = obs.events.find((e) => e.event === 'daemon.connect_failure');
    expect(failure.error_code).toBe('ENGINE_EXITED');
    expect(obs.names()).not.toContain('daemon.start');
  });

  test('a normal shutdown frame records no engine_exit', async () => {
    const root = tmpRoot();
    const obs = collector();
    const { createCall } = engineStub();
    const daemon = await startDaemon({ projectRoot: root, createCall, recorderFor: () => obs });
    expect(await sessionClient.requestShutdown(root)).toBe(true);
    await daemon.whenStopped;
    expect(obs.names()).not.toContain('daemon.engine_exit');
  });

  test('a second engine-exit signal is a no-op', async () => {
    const root = tmpRoot();
    const obs = collector();
    const { createCall, s } = engineStub();
    const daemon = await startDaemon({ projectRoot: root, createCall, recorderFor: () => obs });
    s.exit();
    s.exit();
    await daemon.whenStopped;
    expect(obs.names().filter((n) => n === 'daemon.engine_exit')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx jest tests/unit/device/daemon-engine-exit.test.js`
Expected: FAIL — `engine_alive` undefined; `whenStopped` never resolves for the exit test (jest timeout).

- [ ] **Step 3: Implement the daemon changes**

In `src/device/session-daemon.js`, immediately before the existing comment `// Build the single shared connection up front.`, insert:

```js
  // Engine liveness (#156), in two phases. Until the daemon is serving, an
  // engine exit only marks the flag — the check after listen() below turns it
  // into a failed start, so no handle is ever written for a dead engine. Once
  // serving, `onEngineGone` is rebound to reap the daemon. The arrow passed to
  // createCall reads the binding at call time, which is what makes the rebind
  // take effect.
  let engineAlive = true;
  let onEngineGone = () => {
    engineAlive = false;
  };
```

Change the `createCall` invocation from:

```js
    ({ call, close } = await createCall({ device }));
```

to:

```js
    ({ call, close } = await createCall({ device, onEngineExit: () => onEngineGone() }));
```

Change the ping reply from:

```js
          await reply({ id: req.id, ok: true, result: { pong: true, device, in_flight: inFlight } });
```

to:

```js
          await reply({
            id: req.id,
            ok: true,
            result: { pong: true, device, in_flight: inFlight, engine_alive: engineAlive },
          });
```

Immediately after the listen `try { ... } catch (err) { ... throw err; }` block and **before** the comment `// Persist handle + pidfile now that we are actually listening.`, insert:

```js
  // The engine died between connect and listen. Fail the start exactly like a
  // listen failure — before the handle exists, so nothing reading it is told a
  // dead session is ready. The bin's main().catch exits 1; the spawner sees a
  // start that never became ready.
  if (!engineAlive) {
    safeObserve({
      level: 'error',
      event: 'daemon.connect_failure',
      error_code: 'ENGINE_EXITED',
      message: 'mobile-mcp exited before the device session daemon was ready',
      dur_ms: Date.now() - startedAtMs,
    });
    await new Promise((resolve) => server.close(() => resolve()));
    safeUnlink(socketPath);
    try {
      await close();
    } catch (_) {
      /* best-effort */
    }
    releaseLock();
    const e = new Error('mobile-mcp exited before the device session daemon was ready');
    e.code = 'ENGINE_EXITED';
    throw e;
  }

  // Serving from here on: an engine exit reaps the daemon. Recorded first and
  // synchronously, like the crash guards — stop() can block on the in-flight
  // drain. stop() is the existing path unchanged: drain, destroy sockets, close
  // the server, close() (a no-op on a dead engine), unlink, release the lock,
  // resolve whenStopped. The next verb autostarts a fresh daemon.
  onEngineGone = () => {
    if (!engineAlive) return;
    engineAlive = false;
    safeObserve({ level: 'error', event: 'daemon.engine_exit', dur_ms: Date.now() - startedAtMs });
    stop('engine_exit').catch(() => {});
  };
```

`socketPath`, `server`, `close`, `releaseLock`, `safeObserve`, `startedAtMs`, `safeUnlink` and `stop` are all already in scope at that point (`stop` is a hoisted function declaration).

- [ ] **Step 4: Register the vocabulary**

`src/observe/vocab.js` — add after `'daemon.connect_failure',`:

```js
  'daemon.engine_exit',
```

Replace:

```js
// Why the daemon stopped. 'crash' is documented but not yet produced.
const STOP_REASONS = Object.freeze(['idle', 'signal', 'shutdown', 'crash', 'explicit']);

// Node/libuv errno names for this platform, plus our own ELOCKED (a lock
// conflict, recorded by src/device/session-daemon.js). Names only: the numeric codes an MCP
// server reports are not in this set and so never pass.
const ERROR_CODES = Object.freeze([...Object.keys(os.constants.errno), 'ELOCKED']);
```

with:

```js
// Why the daemon stopped. 'crash' is documented but not yet produced.
// 'engine_exit': the mobile-mcp engine died under a serving daemon (#156).
const STOP_REASONS = Object.freeze(['idle', 'signal', 'shutdown', 'crash', 'explicit', 'engine_exit']);

// Node/libuv errno names for this platform, plus our own codes, all recorded by
// src/device/: ELOCKED (a lock conflict, session-daemon.js),
// ENGINE_CONNECT_TIMEOUT (initialize exceeded its bound, mobile-mcp-client.js)
// and ENGINE_EXITED (the engine died before the daemon was serving,
// session-daemon.js). Names only: the numeric codes an MCP server reports are
// not in this set and so never pass.
const ERROR_CODES = Object.freeze([
  ...Object.keys(os.constants.errno),
  'ELOCKED',
  'ENGINE_CONNECT_TIMEOUT',
  'ENGINE_EXITED',
]);
```

`src/observe/event.js:123` — change the description `'enumerated: idle|signal|shutdown|crash|explicit'` to `'enumerated: idle|signal|shutdown|crash|explicit|engine_exit'`.

`src/observe/event.js:126` — change `'Node/libuv errno string (EADDRINUSE|EACCES|…) plus our own ELOCKED'` to `'Node/libuv errno string (EADDRINUSE|EACCES|…) plus our own ELOCKED|ENGINE_CONNECT_TIMEOUT|ENGINE_EXITED'`.

`tests/lint/telemetry-vocab-drift.test.js` — in `stopReasonsInDaemon`, both regexes match `[a-z]+`, which cannot see `stop('engine_exit')`. Change:

```js
    const call = /\bstop\(\s*'([a-z]+)'/g;
```
to
```js
    const call = /\bstop\(\s*'([a-z_]+)'/g;
```
and
```js
    const dflt = /function stop\(\s*reason\s*=\s*'([a-z]+)'/g;
```
to
```js
    const dflt = /function stop\(\s*reason\s*=\s*'([a-z_]+)'/g;
```

`docs/reference/telemetry.md:80-81` — replace the two rows with:

```markdown
| `stop_reason` | Why the daemon stopped: `idle`, `signal`, `shutdown`, `crash`, `explicit`, `engine_exit` (the device engine died under it). |
| `error_code` | A Node/libuv errno string such as `EACCES`, or one of mauto's own: `ELOCKED`, `ENGINE_CONNECT_TIMEOUT`, `ENGINE_EXITED`. |
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest tests/unit/device/daemon-engine-exit.test.js tests/unit/device tests/lint/telemetry-vocab-drift.test.js tests/lint/telemetry-docs.test.js tests/unit/observe`
Expected: PASS. Existing daemon tests' stub `createCall`s ignore the new `onEngineExit` argument.

- [ ] **Step 6: Commit**

```bash
cd /Users/mohamedshalan/orca/workspaces/mobile-automator/bug-daemon-lifecycle-unbounded-mobile-mcp-connec
git branch --show-current   # must print fix/156-daemon-lifecycle
git add src/device/session-daemon.js src/observe/vocab.js src/observe/event.js tests/lint/telemetry-vocab-drift.test.js docs/reference/telemetry.md tests/unit/device/daemon-engine-exit.test.js
git commit -m "fix(device): the session daemon reaps itself when its engine dies (#156)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `session end` waits for death and escalates

**Files:**
- Modify: `src/device/session-daemon.js:744` (export `readPidFile`)
- Modify: `src/device/connection.js:84-88` (`endSession`), exports
- Modify: `src/cli.js:1240-1248` (`handleSessionEnd`)
- Modify: `tests/unit/device/connection.test.js:134-139`
- Modify: `tests/unit/cli.test.js:1320-1334`
- Modify: `tests/unit/device/timeout-invariant.test.js`

**Interfaces:**
- Consumes: `waitForDeath`, `terminate` (Task 1); `pidIdentity(pid) → 'dead'|'ours'|'other'|'unknown'`, `DAEMON_CALL_TIMEOUT_MS` (existing, `session-daemon.js`).
- Produces:
  - `END_BUDGET_MS` export of `connection.js` (= `DAEMON_CALL_TIMEOUT_MS + 10000`).
  - `endSession(projectRoot, { client, reaper, identify, readPid, budgetMs }) → Promise<{ stopped: boolean, already_stopped: boolean, forced: boolean, pid: number|null }>`. A failure is `stopped:false && already_stopped:false`, with `pid` set.
  - `handleSessionEnd({ projectRoot, client, end })` — `end` is spread into `endSession`'s options (test seam).

- [ ] **Step 1: Write the failing tests**

Replace the `describe('endSession', ...)` block in `tests/unit/device/connection.test.js` with:

```js
  describe('endSession (#156)', () => {
    // Every dependency faked: no socket, no pidfile, no signals.
    function deps({ pid = 4000, acked = true, diesWithin = true, identity = 'ours', outcome = 'dead' } = {}) {
      const log = [];
      return {
        log,
        opts: {
          client: { requestShutdown: async () => { log.push('shutdown'); return acked; } },
          readPid: () => pid,
          identify: (p) => { log.push(['identify', p]); return identity; },
          budgetMs: 35000,
          reaper: {
            waitForDeath: async (p, o) => { log.push(['wait', p, o.budgetMs]); return diesWithin; },
            terminate: async (p, o) => { log.push(['terminate', p, o.group]); return outcome; },
          },
        },
      };
    }
    const ok = { stopped: true, already_stopped: false, forced: false };
    const none = { stopped: false, already_stopped: true, forced: false };

    test('reads the pid BEFORE asking the daemon to shut down', async () => {
      const order = [];
      const d = deps();
      d.opts.readPid = () => { order.push('readPid'); return 4000; };
      d.opts.client.requestShutdown = async () => { order.push('shutdown'); return true; };
      await endSession('/x', d.opts);
      expect(order).toEqual(['readPid', 'shutdown']);
    });

    test('ack + death within the budget: stopped, not forced', async () => {
      const d = deps();
      expect(await endSession('/x', d.opts)).toEqual({ ...ok, pid: 4000 });
      expect(d.log).toContainEqual(['wait', 4000, 35000]);
      expect(d.log.find((e) => e[0] === 'terminate')).toBeUndefined();
    });

    test('ack + outlives the budget + ours: escalated, forced', async () => {
      const d = deps({ diesWithin: false, identity: 'ours', outcome: 'dead' });
      expect(await endSession('/x', d.opts)).toEqual({ stopped: true, already_stopped: false, forced: true, pid: 4000 });
      expect(d.log).toContainEqual(['terminate', 4000, true]);
    });

    test('ack + outlives the budget + survives escalation: failure with pid', async () => {
      const d = deps({ diesWithin: false, identity: 'ours', outcome: 'survived' });
      expect(await endSession('/x', d.opts)).toEqual({ stopped: false, already_stopped: false, forced: false, pid: 4000 });
    });

    test('unknown identity is never signalled', async () => {
      const d = deps({ diesWithin: false, identity: 'unknown' });
      expect(await endSession('/x', d.opts)).toEqual({ stopped: false, already_stopped: false, forced: false, pid: 4000 });
      expect(d.log.find((e) => e[0] === 'terminate')).toBeUndefined();
    });

    test('a recycled pid (other) is reported gone, never signalled', async () => {
      const d = deps({ diesWithin: false, identity: 'other' });
      expect(await endSession('/x', d.opts)).toEqual({ ...ok, pid: 4000 });
      expect(d.log.find((e) => e[0] === 'terminate')).toBeUndefined();
    });

    test('no ack but a live daemon of ours: escalated with budget 0', async () => {
      const d = deps({ acked: false, diesWithin: false, identity: 'ours', outcome: 'dead' });
      expect(await endSession('/x', d.opts)).toEqual({ stopped: true, already_stopped: false, forced: true, pid: 4000 });
      expect(d.log).toContainEqual(['wait', 4000, 0]);
    });

    test('no ack and a dead pidfile pid: nothing was running', async () => {
      const d = deps({ acked: false, diesWithin: true });
      expect(await endSession('/x', d.opts)).toEqual({ ...none, pid: 4000 });
    });

    test('no pidfile + ack: stopped (as before)', async () => {
      const d = deps({ pid: null, acked: true });
      expect(await endSession('/x', d.opts)).toEqual({ ...ok, pid: null });
    });

    test('no pidfile + no ack: already stopped (as before)', async () => {
      const d = deps({ pid: null, acked: false });
      expect(await endSession('/x', d.opts)).toEqual({ ...none, pid: null });
    });

    // Review Focus 1: in-process daemon tests write the TEST RUNNER's pid to
    // the pidfile. Waiting on it would burn the budget; signalling it would
    // kill jest.
    test('never signals its own process', async () => {
      const d = deps({ pid: process.pid, diesWithin: false, identity: 'ours' });
      expect(await endSession('/x', d.opts)).toEqual({ ...ok, pid: process.pid });
      expect(d.log.find((e) => e[0] === 'wait' || e[0] === 'terminate')).toBeUndefined();
    });

    test('defaults: a workspace with no pidfile behaves as before', async () => {
      const client = { requestShutdown: async () => true };
      expect(await endSession('/nonexistent-mauto-root', { client })).toEqual({ ...ok, pid: null });
    });
  });
```

Replace the `describe('handleSessionEnd', ...)` block in `tests/unit/cli.test.js` with:

```js
  describe('handleSessionEnd (#156)', () => {
    // Stub connection.endSession's dependencies so it returns a chosen outcome.
    function run(outcome) {
      const reaper = {
        waitForDeath: async () => outcome !== 'escalated' && outcome !== 'survived',
        terminate: async () => (outcome === 'escalated' ? 'dead' : 'survived'),
      };
      return handleSessionEnd({
        projectRoot: '/x',
        client: { requestShutdown: async () => outcome !== 'none' },
        end: {
          readPid: () => (outcome === 'none' ? null : 4000),
          identify: () => 'ours',
          reaper,
        },
      });
    }

    test('stopped cleanly: ok, forced:false, no hint', async () => {
      const r = await run('clean');
      expect(r.exitKind).toBe('ok');
      expect(r.envelope.data).toEqual({ stopped: true, already_stopped: false, forced: false });
      expect(r.envelope.hint).toBeUndefined();
    });

    test('stopped by escalation: ok, forced:true, hint names the pid', async () => {
      const r = await run('escalated');
      expect(r.exitKind).toBe('ok');
      expect(r.envelope.data).toEqual({ stopped: true, already_stopped: false, forced: true });
      expect(r.envelope.hint).toContain('terminated pid 4000');
    });

    test('nothing running: ok, already_stopped', async () => {
      const r = await run('none');
      expect(r.exitKind).toBe('ok');
      expect(r.envelope.data).toEqual({ stopped: false, already_stopped: true, forced: false });
    });

    test('survivor: fail(device) with the pid, pidfile and log in the hint', async () => {
      const r = await run('survived');
      expect(r.exitKind).toBe('device');
      expect(r.envelope.ok).toBe(false);
      expect(r.envelope.error.message).toBe('device session daemon pid 4000 did not exit');
      expect(r.envelope.data).toEqual({ stopped: false, already_stopped: false, pid: 4000 });
      expect(r.envelope.hint).toContain(sessionPaths.pidFilePath('/x'));
      expect(r.envelope.hint).toContain(sessionPaths.logFilePath('/x'));
    });
  });
```

Envelope shapes (verified in `src/output/envelope.js`): `ok(data, hint)` omits the `hint` key entirely when there is no hint; `fail(kind, message, hint, data)` produces `{ ok:false, error:{ kind, message }, hint, data }`.

Append to `tests/unit/device/timeout-invariant.test.js`:

```js
// #156: `session end` must outwait a daemon that is legitimately finishing —
// a drain bounded by the daemon call timeout, then the SDK's ~4s close ladder —
// before it concludes the daemon is stuck and escalates.
describe('session end budget invariant (#156)', () => {
  test('END_BUDGET > DAEMON_CALL_TIMEOUT + SDK close escalation', () => {
    const { END_BUDGET_MS } = require('../../../src/device/connection');
    expect(END_BUDGET_MS).toBeGreaterThan(sessionDaemon.DAEMON_CALL_TIMEOUT_MS + 4000);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx jest tests/unit/device/connection.test.js tests/unit/cli.test.js -t "endSession|handleSessionEnd" ; npx jest tests/unit/device/timeout-invariant.test.js`
Expected: FAIL — `endSession` returns a boolean; `END_BUDGET_MS` undefined.

- [ ] **Step 3: Implement**

`src/device/session-daemon.js` — change the final export line to add `readPidFile`:

```js
module.exports = { startDaemon, cleanStale, pidAlive, pidIdentity, readPidFile, DAEMON_CALL_TIMEOUT_MS, DEFAULT_IDLE_MS };
```

`src/device/connection.js` — add near the other requires at the top:

```js
const sessionDaemon = require('./session-daemon');
const processReaper = require('./process-reaper');
```

Replace:

```js
// Ask a live daemon to shut down. Resolves true when one acknowledged.
function endSession(projectRoot, { client = sessionClient } = {}) {
  return client.requestShutdown(projectRoot);
}
```

with:

```js
// How long `session end` waits for an acknowledged daemon to exit before it
// treats it as stuck: stop() drains in-flight calls (bounded by the daemon call
// timeout) and then closes the engine (the SDK's ~4s ladder). Derived, not
// restated; pinned by tests/unit/device/timeout-invariant.test.js.
const END_BUDGET_MS = sessionDaemon.DAEMON_CALL_TIMEOUT_MS + 10000;

// Stop the daemon and report only what is true (#156). The daemon acks the
// shutdown frame BEFORE its teardown runs, so an ack is a promise, not a fact:
// stopped:true is reported only once the pid is gone.
//
// Returns { stopped, already_stopped, forced, pid }. stopped:false with
// already_stopped:false is a failure — the daemon is still alive.
async function endSession(
  projectRoot,
  {
    client = sessionClient,
    reaper = processReaper,
    identify = (pid) => sessionDaemon.pidIdentity(pid),
    readPid = () => sessionDaemon.readPidFile(paths.pidFilePath(projectRoot)),
    budgetMs = END_BUDGET_MS,
  } = {}
) {
  // Read BEFORE asking: a daemon that exits cleanly removes its pidfile, and we
  // need to know whom to watch.
  const pid = readPid();
  const acked = await client.requestShutdown(projectRoot);
  const result = (stopped, forced = false) => ({
    stopped,
    already_stopped: !stopped && !acked,
    forced,
    pid: pid || null,
  });

  // No pidfile: nothing to watch, so the ack is all we have (as before). Our
  // own pid: the in-process daemon of a test — never wait on it, never signal it.
  if (!pid || pid === process.pid) return result(acked);

  // A non-acking daemon whose pidfile names a live process is checked at once
  // (budget 0): either it is gone, or it is stuck too badly to answer.
  if (await reaper.waitForDeath(pid, { budgetMs: acked ? budgetMs : 0 })) return result(acked);

  switch (identify(pid)) {
    case 'dead':
    case 'other': // the pid was recycled: our daemon is gone
      return result(acked);
    case 'ours':
      if ((await reaper.terminate(pid, { group: true })) === 'dead') {
        return { stopped: true, already_stopped: false, forced: true, pid };
      }
      return { stopped: false, already_stopped: false, forced: false, pid };
    default: // 'unknown': never signal a process we cannot identify
      return { stopped: false, already_stopped: false, forced: false, pid };
  }
}
```

Add `END_BUDGET_MS` to `module.exports` of `connection.js`.

Check for a require cycle: `connection.js` → `session-daemon.js` must not require `connection.js` (it does not; it requires `session-paths`, `session-protocol`, `session-handle`, `device-call`, `observe/*`). `process-reaper.js` → `session-daemon.js` is fine for the same reason.

`src/cli.js` — replace `handleSessionEnd` with:

```js
async function handleSessionEnd(
  { projectRoot, client = require('./device/session-client'), end = {} } = {}
) {
  const r = await connection.endSession(projectRoot, { client, ...end });
  const logHint = connection.daemonLogHint(projectRoot);
  if (!r.stopped && !r.already_stopped) {
    const pidFile = require('./device/session-paths').pidFilePath(projectRoot);
    return {
      envelope: fail(
        'device',
        `device session daemon pid ${r.pid} did not exit`,
        `It may still hold the workspace lock, or could not be confirmed as a mauto daemon and so was not signalled. Check it with \`ps -p ${r.pid}\` and stop it with \`kill -9 ${r.pid}\` (pidfile: ${pidFile}). ${logHint}`,
        { stopped: false, already_stopped: false, pid: r.pid }
      ),
      exitKind: 'device',
    };
  }
  const data = { stopped: r.stopped, already_stopped: r.already_stopped, forced: r.forced };
  const hint = r.forced
    ? `The daemon did not exit after shutdown; terminated pid ${r.pid}. ${logHint}`
    : null;
  return { envelope: ok(data, hint), exitKind: 'ok' };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/unit/device/connection.test.js tests/unit/cli.test.js tests/unit/device/timeout-invariant.test.js tests/integration/cli-smoke.test.js`
Expected: PASS. If `cli.test.js` has other `session end` assertions outside the replaced block, update them to the new `data` shape (`forced` added).

- [ ] **Step 5: Commit**

```bash
cd /Users/mohamedshalan/orca/workspaces/mobile-automator/bug-daemon-lifecycle-unbounded-mobile-mcp-connec
git branch --show-current   # must print fix/156-daemon-lifecycle
git add src/device/session-daemon.js src/device/connection.js src/cli.js tests/unit/device/connection.test.js tests/unit/cli.test.js tests/unit/device/timeout-invariant.test.js
git commit -m "fix(cli): session end reports stopped only once the daemon is gone (#156)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `session status` reports a dead engine

**Files:**
- Modify: `src/device/session-client.js:150-171` (`getSessionStatus`)
- Modify: `src/device/connection.js` (`sessionStatus`)
- Modify: `src/cli.js:1233-1238` (`handleSessionStatus`)
- Modify: `tests/unit/device/session-client.test.js:66-75`
- Modify: `tests/unit/device/connection.test.js` (`sessionStatus` expectations)
- Modify: `tests/unit/cli.test.js:1293-1318`

**Interfaces:**
- Consumes: ping `engine_alive` (Task 4).
- Produces: `getSessionStatus(projectRoot) → { running, reason: null|'engine_exited', in_flight, device }`; `sessionStatus` always includes `reason` (`null` default); `handleSessionStatus` adds a hint when `reason === 'engine_exited'`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/device/session-client.test.js`, change the two existing expectations:

```js
    expect(await getSessionStatus(root)).toEqual({ running: false, in_flight: null, device: null });
```
→
```js
    expect(await getSessionStatus(root)).toEqual({ running: false, reason: null, in_flight: null, device: null });
```
and
```js
    expect(await getSessionStatus(root)).toEqual({ running: true, in_flight: 0, device: 'emulator-5554' });
```
→
```js
    expect(await getSessionStatus(root)).toEqual({ running: true, reason: null, in_flight: 0, device: 'emulator-5554' });
```

Append inside its `describe('session-client', ...)`:

```js
  // A server speaking the daemon protocol with a chosen ping result.
  function fakeDaemon(root, result) {
    const sock = paths.socketPath(root);
    fs.mkdirSync(path.dirname(sock), { recursive: true });
    const server = net.createServer((s) => {
      const parser = new FrameParser();
      s.setEncoding('utf8');
      s.on('data', (chunk) => {
        for (const f of parser.push(chunk)) {
          if (f.value) s.write(FrameParser.encode({ id: f.value.id, ok: true, result }));
        }
      });
    });
    return new Promise((resolve) => server.listen(sock, () => resolve(server)));
  }

  test('getSessionStatus reports running:false + engine_exited when the engine is dead (#156)', async () => {
    const root = tmpRoot();
    const server = await fakeDaemon(root, { pong: true, device: 'A', in_flight: 1, engine_alive: false });
    try {
      expect(await getSessionStatus(root)).toEqual({ running: false, reason: 'engine_exited', in_flight: 1, device: 'A' });
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  // Review Focus 2: a 0.27.x daemon still running across the upgrade.
  test('a pre-0.28 daemon without engine_alive is running', async () => {
    const root = tmpRoot();
    const server = await fakeDaemon(root, { pong: true, device: null, in_flight: 0 });
    try {
      expect(await getSessionStatus(root)).toEqual({ running: true, reason: null, in_flight: 0, device: null });
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
```

In `tests/unit/device/connection.test.js` `describe('sessionStatus', ...)`, add `reason: null,` to the two `toEqual({...})` objects (after `running: ...`), and append:

```js
    test('passes reason through from the client', async () => {
      const client = { getSessionStatus: async () => ({ running: false, reason: 'engine_exited', in_flight: 0, device: 'A' }) };
      expect((await sessionStatus('/x', { client })).reason).toBe('engine_exited');
    });
```

In `tests/unit/cli.test.js` `describe('handleSessionStatus', ...)`, add `reason: null,` to both expected `data` objects, and append:

```js
    test('a dead engine: running:false with a hint that says why (#156)', async () => {
      const r = await handleSessionStatus({
        projectRoot: '/x',
        client: { getSessionStatus: async () => ({ running: false, reason: 'engine_exited', in_flight: 0, device: 'A' }) },
      });
      expect(r.exitKind).toBe('ok');
      expect(r.envelope.data.running).toBe(false);
      expect(r.envelope.data.reason).toBe('engine_exited');
      expect(r.envelope.hint).toContain('device engine exited');
      expect(r.envelope.hint).toContain(sessionPaths.logFilePath('/x'));
    });

    test('a healthy session carries no hint', async () => {
      const r = await handleSessionStatus({
        projectRoot: '/x',
        client: { getSessionStatus: async () => ({ running: true, in_flight: 0, device: 'A' }) },
      });
      expect(r.envelope.hint).toBeUndefined();
    });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx jest tests/unit/device/session-client.test.js tests/unit/device/connection.test.js tests/unit/cli.test.js -t "Status|status"`
Expected: FAIL — `reason` missing.

- [ ] **Step 3: Implement**

`src/device/session-client.js` — replace `getSessionStatus` with:

```js
// Rich status probe: connect + ping and report whether a daemon is running,
// how many device calls are currently in flight (the double-execution window
// is visible here), and which device it is pinned to. `null`s when not running.
//
// A daemon whose engine has died is NOT running (#156): it is draining toward
// its own exit and can never serve a call. Only an explicit engine_alive:false
// counts — a pre-0.28 daemon omits the field and is treated as alive.
async function getSessionStatus(projectRoot) {
  const down = { running: false, reason: null, in_flight: null, device: null };
  const socket = await connectSocket(paths.socketPath(projectRoot));
  if (!socket) return down;
  const client = wrapSocket(socket);
  try {
    const res = await client.request({ type: 'ping' }, { timeoutMs: 2000 });
    if (!(res && res.ok)) return down;
    const result = res.result || {};
    const seen = {
      in_flight: typeof result.in_flight === 'number' ? result.in_flight : null,
      device: result.device != null ? result.device : null,
    };
    if (result.engine_alive === false) return { running: false, reason: 'engine_exited', ...seen };
    return { running: true, reason: null, ...seen };
  } catch (_) {
    return down;
  } finally {
    await client.close();
  }
}
```

`src/device/connection.js` `sessionStatus` — in the returned object, add after `...status,`:

```js
    // Always present (#156): null, or why a reachable daemon is not running.
    reason: (status && status.reason) || null,
```

`src/cli.js` — replace `handleSessionStatus` with:

```js
async function handleSessionStatus(
  { projectRoot, client = require('./device/session-client') } = {}
) {
  const status = await connection.sessionStatus(projectRoot, { client });
  const hint =
    status.reason === 'engine_exited'
      ? `The device engine exited; this session is shutting down and the next verb starts a fresh one. ${connection.daemonLogHint(projectRoot)}`
      : null;
  return { envelope: ok(status, hint), exitKind: 'ok' };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/unit/device/session-client.test.js tests/unit/device/connection.test.js tests/unit/cli.test.js tests/integration/cli-smoke.test.js`
Expected: PASS. If another test asserts the exact status shape (grep: `grep -rn "in_flight: null, device: null" tests`), add `reason: null` there too.

- [ ] **Step 5: Commit**

```bash
cd /Users/mohamedshalan/orca/workspaces/mobile-automator/bug-daemon-lifecycle-unbounded-mobile-mcp-connec
git branch --show-current   # must print fix/156-daemon-lifecycle
git add src/device/session-client.js src/device/connection.js src/cli.js tests/unit/device/session-client.test.js tests/unit/device/connection.test.js tests/unit/cli.test.js
git commit -m "fix(cli): session status reports a dead engine as not running (#156)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs, changelog, full verification

**Files:**
- Modify: `docs/reference/cli-verbs.md:146-147`
- Modify: `docs/faq.md:649-653`
- Modify: `TROUBLESHOOTING.md`
- Modify: `CHANGELOG.md` (`[0.28.0]` section from Task 1)

**Interfaces:**
- Consumes: the output shapes from Tasks 5 and 6, the events from Task 4.
- Produces: user-facing documentation; no code.

- [ ] **Step 1: Update the verb reference**

`docs/reference/cli-verbs.md` — replace lines 146-147 with:

```markdown
| `mauto session status` | Report `{ running, reason, in_flight, device, log_path }` — `log_path` is reported whether or not a daemon is up; `reason` is `engine_exited` when a reachable daemon's device engine has died (it is shutting down and the next verb starts a fresh one), otherwise `null` |
| `mauto session end` | Stop the daemon and wait until it has exited. A daemon still alive 35s after acknowledging is terminated (`forced: true`). Fails with `kind: device` and the `pid` if the daemon cannot be stopped |
```

- [ ] **Step 2: Update the FAQ**

Read `docs/faq.md:640-660`. Change the comment on the `mauto session status` line to `# -> { running, reason, in_flight, device, log_path }`, and append this sentence to the paragraph that follows the code block (or add it as a new paragraph directly after the block if there is none):

```markdown
`session end` reports `stopped: true` only once the daemon process is gone; a daemon stuck in teardown is terminated and reported with `forced: true`.
```

- [ ] **Step 3: Add the troubleshooting entries**

Read `TROUBLESHOOTING.md` to find the device-session section (search `session`), and add, in that section's heading style:

```markdown
### `session status` reports `reason: "engine_exited"`

The daemon is reachable but its mobile-mcp engine has died, so it can no longer
drive the device. It is already shutting itself down; the next device verb
starts a fresh session. The cause is in the engine's own output in
`mobile-automator/.session/daemon.log`; the structured record is a
`daemon.engine_exit` event followed by `daemon.stop` with
`stop_reason: "engine_exit"` in `mobile-automator/.logs/daemon.ndjson`.

### `session end` reported `forced: true`, or failed with a `pid`

The daemon acknowledged the shutdown but was still alive 35 seconds later —
usually a device call that never returned, or an engine that would not exit.
`forced: true` means mauto terminated it. A failure with `pid` means it could
not be stopped (or could not be confirmed as a mauto daemon, so it was left
alone): check it with `ps -p <pid>` and stop it with `kill -9 <pid>`. Its stale
lock and socket are cleaned automatically by the next session start.

### A verb failed with "mobile-mcp did not finish initializing within 10000ms"

The engine started but never completed its MCP handshake. Nothing is left
running — the engine is terminated before the error is reported. The
structured record is `daemon.connect_failure` with
`error_code: "ENGINE_CONNECT_TIMEOUT"`. Check `daemon.log` for the engine's
own output.
```

- [ ] **Step 4: Fill the changelog section**

In `CHANGELOG.md`, inside `## [0.28.0]`, after the intro paragraph from Task 1 and before its `---`, add:

```markdown
### Fixed

- **A wedged engine no longer hangs a verb or the session.** mobile-mcp's MCP
  handshake is now bounded at 10s (it normally takes ~0.2s); previously only
  the SDK's 60s default bounded it, longer than the 15s window watching it. A
  timed-out engine is terminated before the error is reported
  (`ENGINE_CONNECT_TIMEOUT`).
- **A daemon that is not ready in time is killed.** When `session start` or a
  verb's autostart gives up after 15s, it terminates that daemon's process
  group — daemon and engine — instead of leaving it holding the workspace lock
  for every later verb.
- **`session end` reports `stopped: true` only once the daemon has exited.**
  It previously trusted the shutdown acknowledgement, which the daemon sends
  before tearing down. A daemon still alive 35s later is terminated
  (`forced: true`); one that cannot be stopped is reported as a `device`
  failure with its `pid`. A daemon too stuck to acknowledge at all is no
  longer reported as `already_stopped`.
- **A daemon whose engine dies now shuts itself down** (`daemon.engine_exit`,
  `stop_reason: "engine_exit"`), and the next verb starts a fresh one.
  `session status` reports such a daemon as `running: false` with
  `reason: "engine_exited"`.

### Changed

- `session end`'s `data` gains `forced`; it can now fail (`ok: false`,
  `kind: device`) when the daemon cannot be stopped.
- `session status`'s `data` gains `reason` (`null` or `"engine_exited"`).
- New telemetry vocabulary: event `daemon.engine_exit`, stop reason
  `engine_exit`, error codes `ENGINE_CONNECT_TIMEOUT` and `ENGINE_EXITED`.
```

- [ ] **Step 5: Run the full verification and show the output**

```bash
cd /Users/mohamedshalan/orca/workspaces/mobile-automator/bug-daemon-lifecycle-unbounded-mobile-mcp-connec
npm test 2>&1 | tail -15
npm run lint:guides 2>&1 | tail -8
npm run lint:schema-additive 2>&1 | tail -5
./scripts/pack-smoke.sh 2>&1 | tail -15
```

Expected: every suite passes; `pack-smoke.sh` ends with a successful `mauto devices` envelope. Paste the tails into the PR's test-plan section and tick the boxes. Any failure: stop, fix, re-run all four — do not claim done on a partial run.

- [ ] **Step 6: Commit and push**

```bash
git branch --show-current   # must print fix/156-daemon-lifecycle
git add docs/reference/cli-verbs.md docs/faq.md TROUBLESHOOTING.md CHANGELOG.md
git commit -m "docs: document the honest session lifecycle (#156)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

- [ ] **Step 7: Note the out-of-scope finding on the PR**

```bash
gh pr comment --body "Out of scope, noted for a follow-up: \`src/observe/vocab.js:88\` and the drift guard say stop reason \`'crash'\` is \"documented but not yet produced\", but \`bin/mauto-session-daemon.js\` \`onFatal\` calls \`daemon.stop('crash')\`. The comment and the guard's \`UNPRODUCED = ['crash']\` look stale (the guard only scans \`session-daemon.js\`, not the bin)."
```
