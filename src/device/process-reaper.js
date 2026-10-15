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
