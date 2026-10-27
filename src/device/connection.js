'use strict';

// The single verb-facing seam for talking to a device.
//
// acquireConnection() hides the daemon-vs-oneshot decision entirely: callers
// get back a uniform { bridge, close } and never learn (or care) whether the
// bridge is daemon-backed or a one-shot spawn. The six-concern decision matrix
// lives privately in resolve-connection.js; this module is the ONE place the
// rest of the app reaches for a connection.
//
// It also fronts the session lifecycle ops (is a daemon alive / spawn one)
// so "should I reuse, spawn, or stop the daemon" has a single owner instead of
// being re-wired independently by the verb path and the lifecycle handlers.
// Ending one is the one exception: endSession lives in session-end.js, which
// this facade AND resolve-connection.js (the stale-engine restart, #251) both
// reach downward — resolve-connection must not require this module back.

const { resolveDeviceConnection } = require('./resolve-connection');
const { readHandle, readSessionId } = require('./session-handle');
const { readEngine, handleEngine } = require('./engine');
const { daemonLogHint } = require('./session-log');
const paths = require('./session-paths');
const sessionClient = require('./session-client');
const sessionSpawn = require('./session-spawn');

// Acquire a device connection, transparently reusing a live daemon when one
// fits and falling back to a one-shot mobile-mcp spawn otherwise. Returns
// { bridge, close }; close() releases this verb's hold — a no-op for the shared
// daemon, a real transport teardown for a one-shot.
//
// `autostart` (default true: the daemon is the normal connection path) is the
// daemon-vs-oneshot policy. cli.js's connectBridge passes false when no
// workspace was discovered (#188), so a workspace-less cwd gets a one-shot
// bridge and no .mobile-automator/.session/ tree. `resolve` is an internal test
// seam only; verbs call acquireConnection with just
// { device, projectRoot, autostart }.
async function acquireConnection({
  device = null,
  projectRoot = process.cwd(),
  autostart = true,
  resolve = resolveDeviceConnection,
} = {}) {
  const { bridge, close } = await resolve({ device, projectRoot, autostart });
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
//
// The engine (#251) is reported twice, on purpose. engine/engine_source are the
// LIVE daemon's, read from its handle (null when not running, like session_id;
// a pre-#251 handle without one is mobilecli with an unknown source).
// resolved_engine/resolved_engine_source are what this workspace resolves now —
// what the next spawn would use — and are always present. When they differ the
// daemon is stale and the next device verb restarts it.
async function sessionStatus(
  projectRoot,
  { client = sessionClient, resolveEngine = readEngine } = {}
) {
  const status = await client.getSessionStatus(projectRoot);
  const running = !!(status && status.running);
  const handle = running ? readHandle(projectRoot) : null;
  const resolved = resolveEngine(projectRoot);
  return {
    ...status,
    // Always present (#156): null, or why a reachable daemon is not running.
    reason: (status && status.reason) || null,
    log_path: paths.logFilePath(projectRoot),
    // Read from the handle, not from the ping reply. The handle is written once
    // the daemon is listening and removed by stop(), so it is the same fact
    // without a second protocol field that could disagree with it — and a verb
    // that wants the id does not have to pay a socket round trip.
    //
    // Deliberately NOT symmetric with log_path, which survives running:false on
    // purpose (a dead daemon's log is exactly what you want then). A SIGKILLed
    // daemon leaves its handle behind, so reporting that id alongside
    // running:false would name a session that no longer exists.
    session_id: running ? readSessionId(projectRoot) : null,
    engine: running ? handleEngine(handle) : null,
    engine_source: (handle && handle.engine_source) || null,
    resolved_engine: resolved.engine,
    resolved_engine_source: resolved.source,
  };
}

// Spawn a daemon and wait until it answers. Resolves true on success.
function startSession({
  projectRoot,
  device = null,
  idleMs,
  engine,
  engineSource,
  spawn = sessionSpawn,
} = {}) {
  return spawn.spawnDaemon({ projectRoot, device, idleMs, engine, engineSource });
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
};
