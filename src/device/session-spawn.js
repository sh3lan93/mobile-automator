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
  openLog = sessionLog.openLogFd,
} = {}) {
  if (!projectRoot) throw new TypeError('spawnDaemon requires projectRoot');

  const env = { ...process.env, MAUTO_SESSION_PROJECT_ROOT: projectRoot };
  if (device) env.MAUTO_SESSION_DEVICE = device;
  if (idleMs !== undefined && idleMs !== null) env.MAUTO_SESSION_IDLE_MS = String(idleMs);

  // Must precede the spawn: the fd has to exist before the child can inherit it.
  // A null handle (read-only or full workspace) degrades to the old behaviour.
  const log = openLog(projectRoot);

  const child = spawn(process.execPath, [DAEMON_BIN], {
    detached: true,
    // stdin stays ignored; stdout and stderr both land in the log. Passing the
    // same fd twice is deliberate — the child gets dups sharing one O_APPEND
    // file description, so the two streams interleave without clobbering.
    // This one descriptor also captures mobile-mcp: the MCP SDK's stdio
    // transport defaults its stderr to 'inherit', so the engine writes to
    // whatever fd 2 the daemon has. Point fd 2 at /dev/null and its crashes
    // vanish with it.
    stdio: log ? ['ignore', log.fd, log.fd] : 'ignore',
    env,
  });

  if (log) {
    // One banner per spawn, so concurrent writers to this append-only file stay
    // separable when reading it back. A fake/failed child may have no pid yet.
    const pid = child && child.pid ? child.pid : '?';
    log.write(`\n=== mauto daemon spawn ${new Date().toISOString()} child_pid=${pid} ===\n`);
    // The child holds its own dup, so the parent releases its descriptor here
    // rather than leaking one per verb invocation.
    log.close();
  }

  // A spawn that fails synchronously (EMFILE, EACCES, ENOENT on the bin) emits
  // an 'error' event instead of throwing. Without a listener that error would
  // crash the one-shot verb process; with it we bail out of the readiness poll
  // immediately instead of waiting out the full 15s window for a child that can
  // never come up. No 'exit' short-circuit here: a loser exiting ELOCKED is
  // expected, and the winner may still come up within the poll window.
  let spawnError = null;
  if (child && typeof child.on === 'function') {
    child.on('error', (err) => {
      spawnError = err;
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
}

module.exports = { spawnDaemon, DAEMON_BIN };
