'use strict';

// The single verb-facing seam for talking to a device.
//
// acquireConnection() hides the daemon-vs-oneshot decision entirely: callers
// get back a uniform { bridge, close } and never learn (or care) whether the
// bridge is daemon-backed or a one-shot spawn. The six-concern decision matrix
// lives privately in resolve-connection.js; this module is the ONE place the
// rest of the app reaches for a connection.
//
// It also owns the session lifecycle ops (is a daemon alive / spawn one / shut
// one down) so "should I reuse, spawn, or stop the daemon" has a single owner
// instead of being re-wired independently by the verb path and the lifecycle
// handlers.

const { resolveDeviceConnection } = require('./resolve-connection');
const { daemonLogHint } = require('./session-log');
const paths = require('./session-paths');
const sessionClient = require('./session-client');
const sessionSpawn = require('./session-spawn');

// Acquire a device connection, transparently reusing a live daemon when one
// fits and falling back to a one-shot mobile-mcp spawn otherwise. Returns
// { bridge, close }; close() releases this verb's hold — a no-op for the shared
// daemon, a real transport teardown for a one-shot.
//
// `resolve` is an internal test seam only; verbs call acquireConnection with
// just { device, projectRoot }.
async function acquireConnection({
  device = null,
  projectRoot = process.cwd(),
  resolve = resolveDeviceConnection,
} = {}) {
  const { bridge, close } = await resolve({ device, projectRoot });
  return { bridge, close };
}

// --- Session lifecycle (one owner for daemon liveness/spawn/shutdown) -------

// Is a device session daemon currently reachable for this workspace?
function isSessionAlive(projectRoot, { client = sessionClient } = {}) {
  return client.isAlive(projectRoot);
}

// Rich status: running + in-flight call count + pinned device (`null`s when not
// running), plus log_path, which is reported unconditionally. The in-flight
// count exposes the double-execution window.
//
// log_path is computed HERE from the project root rather than read out of the
// daemon's ping reply, and that is deliberate: getSessionStatus() collapses
// every failure branch — no socket, non-ok ping, or a throw — into the same
// not-running shape, so a daemon-supplied path would go missing in exactly the
// case where a user is reaching for `session status` to find out why the daemon
// is dead. The path is a pure function of the workspace, so we can always
// answer it. Do not "simplify" this into the ping payload.
async function sessionStatus(projectRoot, { client = sessionClient } = {}) {
  const status = await client.getSessionStatus(projectRoot);
  return { ...status, log_path: paths.logFilePath(projectRoot) };
}

// Spawn a daemon and wait until it answers. Resolves true on success.
function startSession({ projectRoot, device = null, idleMs, spawn = sessionSpawn } = {}) {
  return spawn.spawnDaemon({ projectRoot, device, idleMs });
}

// Ask a live daemon to shut down. Resolves true when one acknowledged.
function endSession(projectRoot, { client = sessionClient } = {}) {
  return client.requestShutdown(projectRoot);
}

module.exports = {
  acquireConnection,
  // Re-exported from session-log so cli.js can name the daemon log through the
  // one device facade it already imports, instead of reaching into a
  // connection-strategy module for a string.
  daemonLogHint,
  isSessionAlive,
  sessionStatus,
  startSession,
  endSession,
};
