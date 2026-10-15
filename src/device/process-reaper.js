'use strict';

// Process termination for the device session lifecycle (#156). Two callers:
// session-spawn.js kills a daemon that never became ready, and `session end`
// (connection.js) escalates a daemon stuck in teardown.
//
// Mechanism only. This module never decides WHOSE pid it is signalling — the
// spawner holds its own ChildProcess, and `session end` runs pidIdentity first.
// Every effect (kill, liveness, clock) is injected so the escalation policy is
// tested once, here, against a fake process table.

const { pidAlive, isZombie } = require('./session-daemon');

// Alive, and not merely awaiting a reaper (#156): kill(pid, 0) succeeds on a
// zombie, so plain liveness waits out a whole budget for a daemon that has
// already exited wherever PID 1 does not reap (see isZombie). The default
// liveness for every wait below; the zombie check runs only for a pid that
// kill(pid, 0) calls alive.
function processAlive(pid) {
  return pidAlive(pid) && !isZombie(pid);
}

// Deliberately NOT unref'd: `session end` is a one-shot verb process with
// nothing else on its event loop while it waits, so an unref'd timer would let
// the process exit mid-wait and report nothing.
function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Resolves true as soon as `done()` holds, false once `budgetMs` has elapsed.
// budgetMs 0 is a single check.
async function waitUntil(done, { budgetMs, pollMs, sleep, now }) {
  const deadline = now() + budgetMs;
  for (;;) {
    if (done()) return true;
    const left = deadline - now();
    if (left <= 0) return false;
    await sleep(Math.min(pollMs, left));
  }
}

// Resolves true as soon as `pid` is dead, false once `budgetMs` has elapsed.
// budgetMs 0 is a single check.
function waitForDeath(
  pid,
  { budgetMs, pollMs = 100, isAlive = processAlive, sleep = defaultSleep, now = Date.now } = {}
) {
  return waitUntil(() => !isAlive(pid), { budgetMs, pollMs, sleep, now });
}

// Does process group `pgid` still have a member? kill(-pgid, 0) succeeds while
// any member exists; EPERM means members we may not signal, which still exist.
function groupExists(kill, pgid) {
  try {
    kill(-pgid, 0);
    return true;
  } catch (err) {
    return !!(err && err.code === 'EPERM');
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
//
// For a group, SIGTERM is enough only once the leader AND every member are
// gone (#156). The leader alone is not the group: a daemon before listen() has
// no SIGTERM handler and dies at once, while mobile-mcp installs one that a
// blocked event loop cannot run — so the engine outlives the leader and must
// still get the SIGKILL. SIGKILL cannot be caught, so after it the leader's
// death is the answer (a member left behind is a zombie awaiting its reaper).
async function terminate(
  pid,
  {
    group = true,
    graceMs = 2000,
    pollMs = 50,
    kill = process.kill.bind(process),
    isAlive = processAlive,
    sleep = defaultSleep,
    now = Date.now,
  } = {}
) {
  // kill(0) / kill(-1) / a negative pid would signal our own group or every
  // process we own. Refuse rather than guess. A GROUP kill of pid 1 is
  // kill(-1) — the same broadcast — so it is refused too.
  if (!Number.isInteger(pid) || pid <= 0 || (group && pid === 1)) {
    throw new TypeError(`terminate requires a positive integer pid${group ? ' above 1' : ''}, got ${pid}`);
  }
  const target = group ? -pid : pid;
  const wait = { budgetMs: graceMs, pollMs, sleep, now };
  const gone = group
    ? () => !isAlive(pid) && !groupExists(kill, pid)
    : () => !isAlive(pid);

  if (send(kill, target, 'SIGTERM') === 'denied') return isAlive(pid) ? 'survived' : 'dead';
  if (await waitUntil(gone, wait)) return 'dead';
  if (send(kill, target, 'SIGKILL') === 'denied') return isAlive(pid) ? 'survived' : 'dead';
  if (await waitUntil(() => !isAlive(pid), wait)) return 'dead';
  return 'survived';
}

module.exports = { waitForDeath, terminate, processAlive };
