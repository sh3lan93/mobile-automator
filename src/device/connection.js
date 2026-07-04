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
  isSessionAlive,
  startSession,
  endSession,
};
