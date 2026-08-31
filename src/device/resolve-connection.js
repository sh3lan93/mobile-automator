'use strict';

// Decides HOW a one-shot verb gets its device connection, transparently
// reusing a persistent daemon when one fits.
//
// Returns { bridge, close, source } where source is 'daemon' | 'oneshot'.
//
// Branches (in order):
//   (a) daemon live AND its device pin matches the requested device
//         -> daemon-backed bridge; close() is a NO-OP (must NOT tear the
//            shared daemon down — other verbs depend on it).
//   (b) device-pin MISMATCH (daemon bound to A, verb asks for B)
//         -> one-shot connection for this call (do not silently reuse A).
//   (c) autostart && no reachable daemon
//         -> spawn a daemon, then connect daemon-backed (no-op close).
//   (d) spawn failed, or autostart:false
//         -> one-shot fallback via the real createCall (real close). When the
//            spawn is what failed, a thrown one-shot error is decorated with a
//            hint naming the daemon log so the crash stays findable (#163).
//
// Everything device-touching is injected so the whole matrix is unit-testable
// with a fake daemon + fake createCall + fake spawn.

const fs = require('fs');

const { DeviceBridge } = require('./bridge');
const paths = require('./session-paths');
const sessionClient = require('./session-client');
const sessionSpawn = require('./session-spawn');

function defaultCreateCall(opts) {
  return require('./mobile-mcp-client').createCall(opts);
}

const NOOP_CLOSE = () => Promise.resolve();

// The one sentence that points a user at the daemon's captured output (#163).
// Shared with cli.js's `session start` failure envelope so the two moments a
// user can learn the log exists word it identically.
function daemonLogHint(projectRoot) {
  return `The daemon's output (including stack traces) was captured to ${paths.logFilePath(projectRoot)}.`;
}

// Read the live daemon's pinned device from its handle, or null. A null pin
// means the daemon serves whatever device mobile-mcp selected (matches any
// request that doesn't pin a specific device).
function readHandleDevice(projectRoot) {
  try {
    const raw = fs.readFileSync(paths.handlePath(projectRoot), 'utf8');
    const handle = JSON.parse(raw);
    return handle && handle.device ? handle.device : null;
  } catch (_) {
    return null;
  }
}

// Does a daemon pinned to `handleDevice` satisfy a request for `requested`?
// - request without --device  -> reuse any live daemon.
// - request with --device     -> only reuse when the pins are equal.
function deviceMatches(requested, handleDevice) {
  if (!requested) return true;
  return requested === handleDevice;
}

// PURE decision: given the observed facts, which strategy should we run?
//   'daemon'           — a live daemon fits; connect daemon-backed (no-op close)
//   'oneshot'          — connect once for this call (real close)
//   'spawn-then-daemon'— no daemon fits but autostart is on; spawn then connect
//
// Zero collaborators, no I/O — value-in/value-out so the branching can be tested
// without faking a client/spawn/createCall or writing a handle to disk. The
// effectful resolver (below) gathers the facts, calls this, and runs exactly one
// of the three thin effect paths.
function chooseConnectionStrategy({ alive, handleDevice, requestedDevice, autostart }) {
  if (alive && deviceMatches(requestedDevice, handleDevice)) return 'daemon';
  if (alive) return 'oneshot'; // live daemon, but its device pin mismatches
  if (autostart) return 'spawn-then-daemon';
  return 'oneshot';
}

async function resolveDeviceConnection({
  device = null,
  projectRoot = process.cwd(),
  autostart = true,
  // Injectable seams (tests override these).
  client = sessionClient,
  spawn = sessionSpawn,
  createCall = defaultCreateCall,
  idleMs = undefined,
} = {}) {
  const oneShot = async () => {
    const { call, close } = await createCall({ device });
    return { bridge: new DeviceBridge({ call, device }), close, source: 'oneshot' };
  };

  const daemonBacked = async () => {
    const conn = await client.tryConnect(projectRoot);
    if (!conn) return null;
    // The verb's `device` may be null while the daemon is pinned to a device;
    // fall back to the live handle's pin so getPlatform() resolves correctly.
    const pinned = device || readHandleDevice(projectRoot);
    // close() is a no-op AND we must release our socket so the daemon's idle
    // timer can fire — wrap close to end the underlying socket but never stop
    // the shared daemon.
    return {
      bridge: new DeviceBridge({ call: conn.call, device: pinned }),
      close: async () => {
        try {
          await conn.close();
        } catch (_) {
          /* ignore */
        }
      },
      source: 'daemon',
    };
  };

  const alive = await client.isAlive(projectRoot);

  if (alive) {
    const handleDevice = readHandleDevice(projectRoot);
    const strategy = chooseConnectionStrategy({
      alive: true,
      handleDevice,
      requestedDevice: device,
      autostart,
    });
    if (strategy === 'daemon') {
      // (a) reuse the live daemon.
      const conn = await daemonBacked();
      if (conn) return conn;
      // Race: daemon vanished between isAlive and connect — fall through and
      // re-decide as if no daemon were alive.
    } else {
      // (b) device-pin mismatch: never silently reuse the wrong device.
      return oneShot();
    }
  }

  // No live daemon (or it vanished mid-flight): spawn-then-daemon vs one-shot.
  const strategy = chooseConnectionStrategy({
    alive: false,
    handleDevice: null,
    requestedDevice: device,
    autostart,
  });
  if (strategy === 'spawn-then-daemon') {
    // (c) spawn a daemon, then connect daemon-backed.
    const started = await spawn.spawnDaemon({ projectRoot, device, idleMs });
    if (started) {
      const conn = await daemonBacked();
      if (conn) return conn;
      // Spawn worked; the daemon just wasn't reachable. Its log has nothing to
      // say about a subsequent one-shot failure, so no hint — fall through.
    } else {
      // The daemon died on startup and its log is the only record of why.
      // Transparent autostart is the common path (most users never type
      // `mauto session start`), so without this the log stays invisible to
      // almost everyone.
      //
      // The signal rides the existing err.hint channel on purpose. deviceFail()
      // in cli.js already surfaces err.hint and all nine device verb paths route
      // through it, so this reaches every verb with no change to the
      // acquireConnection contract — which connection.js deliberately keeps
      // narrow ("callers never learn (or care)" which path served them).
      // Widening the return type with a source/spawnFailed flag would fight
      // that design and force every caller to care.
      try {
        return await oneShot();
      } catch (err) {
        // Never clobber a more specific hint the transport already attached.
        if (!err.hint) err.hint = daemonLogHint(projectRoot);
        throw err;
      }
    }
  }

  // (d) explicit one-shot, or spawn failed / unreachable.
  return oneShot();
}

module.exports = {
  resolveDeviceConnection,
  chooseConnectionStrategy,
  daemonLogHint,
  deviceMatches,
  readHandleDevice,
};
