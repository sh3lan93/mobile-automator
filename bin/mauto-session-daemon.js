#!/usr/bin/env node
'use strict';

// Detached entrypoint for the device session daemon. session-spawn.js launches
// this with the project root / device / idle timeout passed via env vars.
//
// Kept dependency-light and side-effect-free at require time so the unit smoke
// test can load it without spawning a daemon: startDaemon only runs under
// `require.main === module`.

const fs = require('fs');

const { startDaemon } = require('../src/device/session-daemon');
const paths = require('../src/device/session-paths');
const { boundRecorder } = require('../src/observe/recorder');
const { daemonEventLogPath } = require('../src/observe/paths');

// Best-effort synchronous unlink — never throws. Used by the crash guards so a
// hard failure can't leave a stale lock/socket/pidfile wedging the next spawn.
function safeUnlinkSync(p) {
  try {
    fs.unlinkSync(p);
  } catch (_) {
    /* not present */
  }
}

// Tear down this process's workspace files (lock/socket/pid/handle) on exit —
// but ONLY if we still own the lock (it holds our pid). This is load-bearing
// for the spawn race: a loser whose startDaemon threw ELOCKED never acquired
// the lock, so it must NOT delete the winner's files. Deleting them would free
// the lock and unlink the live socket path, so the next client re-spawns and a
// second mobile-mcp child starts — the exact C2/B2 orphan the lock prevents.
// Gating on the lock's pid also stops a departing owner from nuking a successor
// that has already taken over the workspace.
function cleanupWorkspaceIfOwned(projectRoot) {
  let owner;
  try {
    owner = fs.readFileSync(paths.lockPath(projectRoot), 'utf8').trim();
  } catch (_) {
    return; // no lock present — nothing of ours to clean
  }
  if (owner !== String(process.pid)) return; // not our lock — leave the owner's files
  safeUnlinkSync(paths.lockPath(projectRoot));
  safeUnlinkSync(paths.socketPath(projectRoot));
  safeUnlinkSync(paths.pidFilePath(projectRoot));
  safeUnlinkSync(paths.handlePath(projectRoot));
}

async function main() {
  // First write of the process, so every later line in the shared append-only
  // log is attributable to a spawn. Written HERE rather than by the spawning
  // parent because only this process knows its own pid, and because a parent
  // banner races the child's own first output (#163). Under the degraded
  // `stdio: 'ignore'` handle this lands in /dev/null, which is correct.
  process.stderr.write(
    `\n=== mauto daemon ${new Date().toISOString()} pid=${process.pid} ===\n`
  );

  const projectRoot = process.env.MAUTO_SESSION_PROJECT_ROOT;
  if (!projectRoot) {
    process.stderr.write('mauto-session-daemon: MAUTO_SESSION_PROJECT_ROOT is required\n');
    process.exit(3);
  }
  const device = process.env.MAUTO_SESSION_DEVICE || null;
  const idleRaw = process.env.MAUTO_SESSION_IDLE_MS;
  const idleMs = idleRaw ? Number(idleRaw) : undefined;

  // Where this process's events go: its own log file (daemon.ndjson, not the
  // CLI's mauto.ndjson — see observe/paths.js). `env` is read once and the log
  // path derived from that same object, so the sinks and the path can never
  // disagree about MAUTO_LOG_DIR. See boundRecorder for why record()'s defaults
  // are wrong for a detached process, and for why a construction failure
  // degrades rather than throwing.
  //
  // The stderr sink is deliberately left in place: the daemon's stderr IS
  // mobile-automator/.session/daemon.log (PR #176), not a terminal, which
  // inverts cli.js finish()'s calculus — a warn line here costs a human no
  // terminal noise and lands next to the adb/simctl output that explains it.
  //
  // A FACTORY, not a recorder. session_id belongs to startDaemon — it mints the
  // id, writes it to the handle and binds it — so this file cannot build a
  // session-bound recorder, and must not try: an id minted here and one written
  // there are two owners that nothing forces to agree. This file owns WHERE the
  // events go; startDaemon owns WHOSE they are.
  const env = process.env;
  const logPath = daemonEventLogPath(projectRoot, env);
  const recorderFor = (fields) => boundRecorder({ projectRoot, env, logPath, fields });

  // Two bindings of that one factory, because the crash guards outlive the
  // question "is there a session yet?".
  //
  // Until startDaemon resolves there is no session to name, so this one carries
  // the process identity alone. Nothing is lost by that: a crash before
  // startDaemon resolves is by definition a daemon that never wrote a handle,
  // so a session id would name nothing a reader could join against, and `pid`
  // already groups those events. The moment the daemon exists we adopt ITS
  // recorder (below), so every later crash — the common case — is stamped with
  // the session whose handle is on disk.
  let observe = recorderFor({ src: 'daemon', pid: process.pid });

  let daemon = null;

  // Crash guards: this is the real, single-daemon process, so a best-effort
  // teardown on a crash keeps a leaked mobile-mcp child / stale files from
  // wedging the next spawn. (Kept OUT of startDaemon so in-process tests that
  // start many daemons don't accumulate global listeners.)
  // 'exit' allows only synchronous work — drop the lock + socket + pidfile so
  // the next spawn isn't wedged by leftovers from this process.
  const onExit = () => cleanupWorkspaceIfOwned(projectRoot);
  process.on('exit', onExit);
  // One fatal handler, two registrations. The two crashes differ by exactly two
  // strings; everything else about them is load-bearing and identical, so they
  // are built from one function rather than kept in sync by hand.
  //
  // Recorded FIRST, before the stderr write and before teardown: these are the
  // invisible deaths #156 is about, and process.exit(1) below is immediate. The
  // file sink appends synchronously, so the line is on disk by the time the
  // process is gone — a buffered sink would lose exactly this event.
  //
  // Two writes on purpose, to two different readers. The structured event
  // carries the classification (and stays one line); the raw stderr write is
  // #176's contract — the full stack, unchanged, in .session/daemon.log.
  //
  // Then tear the daemon down (closing the mobile-mcp child) and let 'exit'
  // clean the files. Recording must not delay or displace the teardown that
  // frees the lock/socket/pidfile, and `daemon` may still be null — a crash can
  // beat startDaemon to it.
  const onFatal = (kind, label) => (err) => {
    observe({
      level: 'error',
      event: 'daemon.crash',
      error_code: err && err.code,
      message: `${kind}: ${err && err.message ? err.message : err}`,
    });
    process.stderr.write(`mauto-session-daemon: ${label} ${err && err.stack ? err.stack : err}\n`);
    if (daemon && typeof daemon.stop === 'function') {
      daemon.stop('crash').catch(() => {});
    }
    process.exit(1);
  };
  process.on('uncaughtException', onFatal('uncaughtException', 'uncaught'));
  process.on('unhandledRejection', onFatal('unhandledRejection', 'unhandled rejection'));

  daemon = await startDaemon({ projectRoot, device, idleMs, recorderFor });
  // Adopt the daemon's own recorder: same log file, now bound to the session id
  // it minted and wrote into the handle. onFatal reads `observe` when it fires,
  // not when it was built, so every crash from here on is joinable to that
  // handle. This is a READ of startDaemon's id, never a second mint of one.
  observe = daemon.observe;
  // Keep the event loop alive until the daemon stops (idle reap / signal /
  // shutdown frame), then exit cleanly.
  await daemon.whenStopped;
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`mauto-session-daemon: ${err.message || err}\n`);
    process.exit(1);
  });
}

module.exports = { main, cleanupWorkspaceIfOwned };
