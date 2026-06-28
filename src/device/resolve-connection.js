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
//         -> one-shot fallback via the real createCall (real close).
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
    if (deviceMatches(device, handleDevice)) {
      // (a) reuse the live daemon.
      const conn = await daemonBacked();
      if (conn) return conn;
      // Race: daemon vanished between isAlive and connect — fall through.
    } else {
      // (b) device-pin mismatch: never silently reuse the wrong device.
      return oneShot();
    }
  }

  if (!autostart) {
    // (d) explicit one-shot.
    return oneShot();
  }

  // (c) no daemon: spawn one, then connect.
  const started = await spawn.spawnDaemon({ projectRoot, device, idleMs });
  if (started) {
    const conn = await daemonBacked();
    if (conn) return conn;
  }

  // (d) spawn failed / unreachable: one-shot fallback.
  return oneShot();
}

module.exports = { resolveDeviceConnection, deviceMatches, readHandleDevice };
