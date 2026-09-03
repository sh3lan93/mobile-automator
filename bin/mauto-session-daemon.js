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
const { newSessionId } = require('../src/device/session-handle');
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

// The daemon's binding of the recorder seam: its own log file (daemon.ndjson,
// not the CLI's mauto.ndjson — see observe/paths.js for why they are separate)
// and its own identity fields on every event. `env` is read once and the log
// path derived from that same object, so the sinks and the path can never
// disagree about MAUTO_LOG_DIR.
//
// The stderr sink is deliberately left in place. The daemon's stderr IS
// mobile-automator/.session/daemon.log (PR #176), not a terminal, which inverts
// cli.js finish()'s calculus: a warn line here costs a human no terminal noise
// and lands next to the adb/simctl output that explains it. That is why daemon
// lifecycle failures are the first events in this codebase to record above
// `info`.
//
// Observability must never be the reason a daemon fails to start. The observe()
// boundRecorder returns already swallows everything, but CONSTRUCTION sits
// outside that guarantee: it resolves levels and computes a log path before any
// event exists. So a throw here degrades to an inert observe, the same shape
// session-log.js uses when it can't open the raw log — a frozen IGNORED handle
// rather than a null every caller has to branch on.
function buildRecorder(projectRoot, sessionId) {
  try {
    const env = process.env;
    return boundRecorder({
      projectRoot,
      env,
      logPath: daemonEventLogPath(projectRoot, env),
      fields: { src: 'daemon', session_id: sessionId },
    });
  } catch (_) {
    return () => {};
  }
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

  // The recorder is built ONCE, here, and bound for this process's lifetime —
  // see boundRecorder in src/observe/recorder.js for why record()'s own defaults
  // (cwd-derived projectRoot, per-call level resolution) are wrong for a
  // detached process that outlives the verb that spawned it.
  //
  // The id is generated HERE rather than inside startDaemon so that the crash
  // guards below — which can fire before startDaemon has resolved — already
  // have an identity to stamp their events with.
  const sessionId = newSessionId();
  const observe = buildRecorder(projectRoot, sessionId);

  let daemon = null;

  // Crash guards: this is the real, single-daemon process, so a best-effort
  // teardown on a crash keeps a leaked mobile-mcp child / stale files from
  // wedging the next spawn. (Kept OUT of startDaemon so in-process tests that
  // start many daemons don't accumulate global listeners.)
  // 'exit' allows only synchronous work — drop the lock + socket + pidfile so
  // the next spawn isn't wedged by leftovers from this process.
  const onExit = () => cleanupWorkspaceIfOwned(projectRoot);
  process.on('exit', onExit);
  process.on('uncaughtException', (err) => {
    // Recorded FIRST, before the stderr write and before teardown: these are the
    // invisible deaths #156 is about, and process.exit(1) below is immediate.
    // The file sink appends synchronously, so this line is on disk by the time
    // the process is gone — a buffered sink would lose exactly this event.
    //
    // Two writes on purpose, to two different readers. The structured event
    // carries the classification (and stays one line); the raw stderr write is
    // #176's contract — the full stack, unchanged, in .session/daemon.log.
    observe({
      level: 'error',
      event: 'daemon.crash',
      error_code: err && err.code,
      message: `uncaughtException: ${err && err.message ? err.message : err}`,
      pid: process.pid,
    });
    process.stderr.write(`mauto-session-daemon: uncaught ${err && err.stack ? err.stack : err}\n`);
    // Tear the daemon down (closes the mobile-mcp child) then let 'exit' clean
    // the files. Unchanged except for the reason — recording must not delay or
    // displace the teardown that frees the lock/socket/pidfile.
    if (daemon && typeof daemon.stop === 'function') {
      daemon.stop('crash').catch(() => {});
    }
    process.exit(1);
  });
  process.on('unhandledRejection', (err) => {
    observe({
      level: 'error',
      event: 'daemon.crash',
      error_code: err && err.code,
      message: `unhandledRejection: ${err && err.message ? err.message : err}`,
      pid: process.pid,
    });
    process.stderr.write(`mauto-session-daemon: unhandled rejection ${err && err.stack ? err.stack : err}\n`);
    // Same teardown as uncaughtException: a rejected promise must not leave a
    // leaked mobile-mcp child / stale files wedging the next spawn.
    if (daemon && typeof daemon.stop === 'function') {
      daemon.stop('crash').catch(() => {});
    }
    process.exit(1);
  });

  daemon = await startDaemon({ projectRoot, device, idleMs, sessionId, observe });
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
