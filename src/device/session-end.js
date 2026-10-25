'use strict';

// Ends a device session daemon, honestly (#156).
//
// Its own module, not a member of connection.js, because two layers need it:
// connection.js (the verb-facing facade `mauto session end` calls through) and
// resolve-connection.js (the connection-strategy layer, which ends a stale-
// engine daemon before respawning it, #251). resolve-connection must not
// require connection — connection requires IT — so the shared path lives here,
// where both reach it downward and the dependency direction stays one-way.

const sessionDaemon = require('./session-daemon');
const sessionClient = require('./session-client');
const paths = require('./session-paths');
const processIdentity = require('./process-identity');
const processReaper = require('./process-reaper');

// How long `session end` waits for an acknowledged daemon to exit before it
// treats it as stuck: stop() drains in-flight calls (bounded by the daemon call
// timeout) and then closes the engine (the SDK's ~4s ladder). Derived, not
// restated; pinned by tests/unit/device/timeout-invariant.test.js.
const END_BUDGET_MS = sessionDaemon.DAEMON_CALL_TIMEOUT_MS + 10000;

// Stop the daemon and report only what is true (#156). The daemon acks the
// shutdown frame BEFORE its teardown runs, so an ack is a promise, not a fact:
// 'stopped' is reported only once the pid is gone.
//
// Returns { outcome, pid } — ONE discriminated answer, so a caller dispatches
// on what happened instead of re-deriving it from a bag of booleans:
//   'stopped'         - acked, and the pid exited (or there was no pid to watch)
//   'already_stopped' - nothing acked and nothing of ours was running
//   'forced'          - ours, stuck in teardown, terminated by a group kill
//   'survived'        - ours, stuck, and still alive after SIGTERM + SIGKILL
//   'foreign'         - acked, but the live pid cannot be tied to this
//                       workspace: its command line names another one, or it
//                       names none and the lock does not name the same pid —
//                       reported, never signalled
//   'unproven'        - not acked, and the live pid is a mauto daemon whose
//                       command line names no workspace (mauto <= 0.27.x, #237):
//                       nothing proves it ours, so it was never signalled, and
//                       it may still hold this workspace's lock
//   'unverified'      - the pid could not be identified (`ps` failed), so it
//                       was never signalled
// The last four are failures: a daemon may still be alive.
async function endSession(
  projectRoot,
  {
    client = sessionClient,
    reaper = processReaper,
    // Bound to THIS workspace (#156): a group kill must never reach another
    // workspace's daemon through a copied or recycled pidfile.
    identify = (pid) => processIdentity.pidIdentity(pid, { projectRoot }),
    readPid = () => processIdentity.readPidFile(paths.pidFilePath(projectRoot)),
    // The lock names the daemon that holds this workspace (#237). It is the
    // second witness for a daemon whose command line carries no marker.
    readLockPid = () => processIdentity.readPidFile(paths.lockPath(projectRoot)),
    budgetMs = END_BUDGET_MS,
  } = {}
) {
  // Read BEFORE asking: a daemon that exits cleanly removes its pidfile and its
  // lock, and we need to know whom to watch — and who held the lock.
  const pid = readPid();
  const lockPid = readLockPid();
  const acked = await client.requestShutdown(projectRoot);
  const report = (outcome) => ({ outcome, pid: pid || null });
  // The daemon is gone: it stopped because we asked, or was never running.
  const gone = () => report(acked ? 'stopped' : 'already_stopped');

  // No pidfile: nothing to watch, so the ack is all we have (as before). Our
  // own pid: the in-process daemon of a test — never wait on it, never signal it.
  if (!pid || pid === process.pid) return gone();

  // A non-acking daemon whose pidfile names a live process is checked at once
  // (budget 0): either it is gone, or it is stuck too badly to answer.
  if (await reaper.waitForDeath(pid, { budgetMs: acked ? budgetMs : 0 })) return gone();

  switch (identify(pid)) {
    case 'dead':
    case 'other': // the pid was recycled: our daemon is gone
      return gone();
    case 'foreign':
      // A mauto daemon whose command line names ANOTHER workspace (or this
      // one's under a salt we cannot read): reached through a copied or
      // recycled pidfile. Never signalled. Without an ack nothing answered on
      // OUR socket, so none of ours was running. With an ack something of ours
      // answered, but this pid is provably not it, so it is reported rather
      // than killed. (Marker-less daemons arrive as 'unmarked' below, #237.)
      return report(acked ? 'foreign' : 'already_stopped');
    case 'unmarked':
      // A mauto daemon whose command line names no workspace at all: one
      // started by mauto <= 0.27.x (#237). Its line proves nothing, so two
      // other witnesses must agree before it is signalled:
      //   - the ack: the socket lives inside this workspace's .session/ and a
      //     Unix socket only accepts on the inode the daemon bound, so a
      //     `cp -R`'d workspace can never make the original's daemon answer;
      //   - the lock naming this same pid, read before the ack, so the daemon
      //     that answered is the one we are about to kill.
      // 0.27.x spawned it detached, so it leads its own process group and the
      // group kill reaches its engine too.
      if (acked && lockPid === pid) {
        return report((await reaper.terminate(pid, { group: true })) === 'dead' ? 'forced' : 'survived');
      }
      // Acked, but the lock does not tie the answer to this pid: report it.
      // Not acked: nothing proves it ours — but nor is it proven gone, and
      // cleanStale (which asks without a root) still respects its lock, so
      // 'already_stopped' would be a lie the next spawn trips over.
      return report(acked ? 'foreign' : 'unproven');
    case 'ours':
      return report((await reaper.terminate(pid, { group: true })) === 'dead' ? 'forced' : 'survived');
    default: // 'unknown': never signal a process we cannot identify
      return report('unverified');
  }
}

// Outcomes after which no daemon of ours is left holding the workspace.
// Anything else ('survived', 'foreign', 'unproven', 'unverified') may leave
// the stale daemon alive — spawning then would just find it answering pings,
// or (for 'unproven') find its lock still held. Lives beside
// the vocabulary it classifies so a new outcome can never drift from its
// classification (#251's restart path, resolve-connection.js, reads it).
const ENDED_OUTCOMES = new Set(['stopped', 'forced', 'already_stopped']);

module.exports = { endSession, END_BUDGET_MS, ENDED_OUTCOMES };
