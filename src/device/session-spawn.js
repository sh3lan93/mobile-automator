'use strict';

// Spawns the device session daemon as a DETACHED background process and waits
// until it is reachable. The spawn fn is injectable so the spawn args and the
// readiness-poll contract are unit-testable without launching a real daemon.

const path = require('path');
const childProcess = require('child_process');

const sessionClient = require('./session-client');

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
} = {}) {
  if (!projectRoot) throw new TypeError('spawnDaemon requires projectRoot');

  const env = { ...process.env, MAUTO_SESSION_PROJECT_ROOT: projectRoot };
  if (device) env.MAUTO_SESSION_DEVICE = device;
  if (idleMs !== undefined && idleMs !== null) env.MAUTO_SESSION_IDLE_MS = String(idleMs);

  const child = spawn(process.execPath, [DAEMON_BIN], {
    detached: true,
    stdio: 'ignore',
    env,
  });

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
