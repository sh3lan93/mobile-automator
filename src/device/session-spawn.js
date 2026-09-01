'use strict';

// Spawns the device session daemon as a DETACHED background process and waits
// until it is reachable. The daemon's output is captured to the workspace log
// (mobile-automator/.session/daemon.log) instead of /dev/null, so a crashing
// engine leaves a readable trace behind. The spawn and openLog fns are
// injectable so the spawn args, the log wiring and the readiness-poll contract
// are all unit-testable without launching a real daemon or touching disk.

const path = require('path');
const childProcess = require('child_process');

const sessionClient = require('./session-client');
const sessionLog = require('./session-log');

const DAEMON_BIN = path.join(__dirname, '..', '..', 'bin', 'mauto-session-daemon.js');
const DEFAULT_READY_TIMEOUT_MS = 15000;
const DEFAULT_POLL_MS = 100;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Returns true once the spawned daemon answers isAlive, false on timeout.
async function spawnDaemon({
  projectRoot,
  device = null,
  idleMs = undefined,
  spawn = childProcess.spawn,
  readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
  pollMs = DEFAULT_POLL_MS,
  isAlive = sessionClient.isAlive,
  openLog = sessionLog.openDaemonLog,
} = {}) {
  if (!projectRoot) throw new TypeError('spawnDaemon requires projectRoot');

  const env = { ...process.env, MAUTO_SESSION_PROJECT_ROOT: projectRoot };
  if (device) env.MAUTO_SESSION_DEVICE = device;
  if (idleMs !== undefined && idleMs !== null) env.MAUTO_SESSION_IDLE_MS = String(idleMs);

  // Must precede the spawn: the fd has to exist before the child can inherit it.
  // Never null — a workspace we cannot write to yields the `stdio: 'ignore'`
  // handle, so there is nothing to branch on here. The daemon writes its own
  // spawn banner (bin/mauto-session-daemon.js), which is why this file no
  // longer needs the child's pid.
  const log = openLog(projectRoot);

  try {
    const child = spawn(process.execPath, [DAEMON_BIN], {
      detached: true,
      stdio: log.stdio,
      env,
    });

    // A spawn that fails to exec (EMFILE, EACCES, ENOENT on the bin) emits an
    // 'error' event instead of throwing. Without a listener that error would
    // crash the one-shot verb process; with it we bail out of the readiness
    // poll immediately instead of waiting out the full 15s window for a child
    // that can never come up. No 'exit' short-circuit here: a loser exiting
    // ELOCKED is expected, and the winner may still come up within the window.
    //
    // The error is also WRITTEN to the log, not just used as a flag: a child
    // that never execs has no stdout/stderr of its own, so the parent is the
    // only witness. Dropping it here would rebuild the exact hole #163 fixes,
    // one layer up.
    let spawnError = null;
    if (child && typeof child.on === 'function') {
      child.on('error', (err) => {
        spawnError = err;
        log.write(`mauto: daemon spawn failed: ${err && err.stack ? err.stack : err}\n`);
      });
    }

    // Let the daemon outlive this one-shot verb process.
    if (child && typeof child.unref === 'function') child.unref();

    const deadline = Date.now() + readyTimeoutMs;
    while (Date.now() < deadline) {
      if (spawnError) return false;
      if (await isAlive(projectRoot)) return true;
      await sleep(pollMs);
    }
    return false;
  } finally {
    // The child holds its own dup, so the parent releases its descriptor rather
    // than leaking one per verb invocation. In `finally` because the 'error'
    // listener above fires asynchronously — the handle has to outlive the poll.
    log.close();
  }
}

module.exports = { spawnDaemon, DAEMON_BIN };
