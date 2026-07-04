'use strict';

// Long-lived device session daemon.
//
// Builds ONE mobile-mcp connection (via the injected `createCall`) and serves
// every connecting one-shot verb over a per-workspace Unix domain socket. The
// single connection is the whole point of the feature: a 40-step scenario pays
// the spawn+handshake tax exactly once.
//
// Lifecycle:
//   - clean any stale socket/pidfile before binding,
//   - listen on the socket, write handle + pidfile once listening,
//   - route { type:'call', tool, args } frames to the single `call`,
//   - reset an idle timer on every request; reap the daemon when it expires,
//   - shut down cleanly on a { type:'shutdown' } control frame and on
//     SIGTERM/SIGINT, removing the socket/pidfile/handle.
//
// Everything that touches a real device is injected, so the full lifecycle is
// unit-testable with a fake createCall and a mkdtemp project root.

const fs = require('fs');
const net = require('net');

const paths = require('./session-paths');
const { encodeResponse, FrameParser } = require('./session-protocol');

const DEFAULT_IDLE_MS = 5 * 60 * 1000;

function defaultCreateCall(opts) {
  return require('./mobile-mcp-client').createCall(opts);
}

// Best-effort unlink — never throws.
function safeUnlink(p) {
  try {
    fs.unlinkSync(p);
  } catch (_) {
    /* not present */
  }
}

// True when a pid is a live process we own. ESRCH => dead; EPERM => alive.
function pidAlive(pid) {
  if (!pid || !Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

// Read a pid out of a one-line pid/lock file, or null when absent/garbage.
function readPidFile(file) {
  try {
    const pid = parseInt(fs.readFileSync(file, 'utf8').trim(), 10);
    return Number.isInteger(pid) ? pid : null;
  } catch (_) {
    return null;
  }
}

// Remove stale socket/pidfile/handle/lock left by a crashed daemon so a fresh
// daemon can bind. Liveness is decided from the LOCK file first (acquired before
// the connection is built, so it covers a daemon still mid-startup) then the
// pidfile (written once listening). If either points at a LIVE process we leave
// everything alone and signal the caller — the lock's O_EXCL or the listen()
// EADDRINUSE then surfaces the conflict rather than hijacking a healthy daemon.
function cleanStale(projectRoot) {
  const pidFile = paths.pidFilePath(projectRoot);
  const lockFile = paths.lockPath(projectRoot);
  let livePid = null;
  for (const f of [lockFile, pidFile]) {
    const pid = readPidFile(f);
    if (pid && pidAlive(pid)) {
      livePid = pid;
      break;
    }
  }
  if (livePid) return { cleaned: false, livePid };

  safeUnlink(paths.socketPath(projectRoot));
  safeUnlink(pidFile);
  safeUnlink(paths.handlePath(projectRoot));
  safeUnlink(lockFile);
  return { cleaned: true, livePid: null };
}

async function startDaemon({
  projectRoot,
  device = null,
  idleMs = DEFAULT_IDLE_MS,
  createCall = defaultCreateCall,
  onUndeliverable = null,
} = {}) {
  if (!projectRoot) throw new TypeError('startDaemon requires projectRoot');

  const dir = paths.sessionDir(projectRoot);
  fs.mkdirSync(dir, { recursive: true });

  // Reap a crashed daemon's leftovers before we bind.
  cleanStale(projectRoot);

  // Acquire an EXCLUSIVE per-workspace lock BEFORE building the connection. Two
  // `mauto` invocations that both saw isAlive=false would otherwise both spawn a
  // daemon and both call createCall (spawning mobile-mcp + grabbing the device)
  // before the loser hits EADDRINUSE. With the lock the loser fails here and
  // exits before it ever spawns a child. O_EXCL ('wx') is the atomicity.
  const lockFile = paths.lockPath(projectRoot);
  let lockFd;
  try {
    lockFd = fs.openSync(lockFile, 'wx');
    fs.writeSync(lockFd, String(process.pid) + '\n');
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      const e = new Error('device session daemon already starting for this workspace (lock held)');
      e.code = 'ELOCKED';
      throw e;
    }
    throw err;
  }

  let lockReleased = false;
  function releaseLock() {
    if (lockReleased) return;
    lockReleased = true;
    try {
      if (lockFd !== undefined) fs.closeSync(lockFd);
    } catch (_) {
      /* ignore */
    }
    safeUnlink(lockFile);
  }

  // Build the single shared connection up front. If it rejects, never leak the
  // lock (and the child it may have started is the connection's own to clean).
  let call;
  let close;
  try {
    ({ call, close } = await createCall({ device }));
  } catch (err) {
    releaseLock();
    throw err;
  }

  let idleTimer = null;
  let stopping = false;
  let inFlight = 0; // device calls whose reply has not yet been sent
  const sockets = new Set();
  const undeliverable = []; // replies we could not deliver (peer gone / unflushable)
  let onStop = null; // resolves stop()'s promise

  const notifyUndeliverable =
    typeof onUndeliverable === 'function'
      ? onUndeliverable
      : (info) => {
          try {
            process.stderr.write(
              `mauto-session-daemon: undeliverable reply id=${info.id}: ${info.reason}\n`
            );
          } catch (_) {
            /* stderr gone */
          }
        };

  function recordUndeliverable(info) {
    undeliverable.push(info);
    notifyUndeliverable(info);
  }

  const server = net.createServer();

  function clearIdle() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function armIdle() {
    clearIdle();
    if (stopping) return; // never re-arm once we have begun tearing down
    if (idleMs > 0 && Number.isFinite(idleMs)) {
      idleTimer = setTimeout(() => {
        stop().catch(() => {});
      }, idleMs);
      if (typeof idleTimer.unref === 'function') idleTimer.unref();
    }
  }

  async function stop() {
    if (stopping) return;
    stopping = true;
    clearIdle();

    // Drain-before-teardown: never destroy a socket or tear down the shared
    // connection while a device call is still in flight. The action already hit
    // the device — its reply must be allowed to go out first.
    while (inFlight > 0) {
      await new Promise((r) => setTimeout(r, 10));
    }

    for (const s of sockets) {
      try {
        s.destroy();
      } catch (_) {
        /* ignore */
      }
    }
    sockets.clear();

    await new Promise((resolve) => server.close(() => resolve()));

    try {
      await close();
    } catch (_) {
      /* best-effort */
    }

    safeUnlink(paths.socketPath(projectRoot));
    safeUnlink(paths.pidFilePath(projectRoot));
    safeUnlink(paths.handlePath(projectRoot));
    releaseLock();

    process.removeListener('SIGTERM', onSignal);
    process.removeListener('SIGINT', onSignal);

    if (onStop) onStop();
  }

  function onSignal() {
    stop().catch(() => {});
  }

  server.on('connection', (socket) => {
    sockets.add(socket);
    const parser = new FrameParser();

    socket.setEncoding('utf8');

    // Honest reply: by the time this runs the device action has ALREADY
    // happened, so a write that fails must never be silently swallowed.
    //   - a non-serializable result is converted to an explicit ok:false frame
    //     rather than dropped (a dropped reply hangs the client to a 30s
    //     false-failure → retry → double tap / re-granted permission);
    //   - socket backpressure (write() === false) is awaited via 'drain' so
    //     large payloads (screenshots, element trees) actually reach the client;
    //   - a destroyed peer / write error is RECORDED as undeliverable, not
    //     swallowed.
    // Returns true when the frame was flushed, false when undeliverable.
    const reply = async (obj) => {
      const id = obj && obj.id != null ? obj.id : null;
      let frame;
      try {
        frame = encodeResponse(obj);
      } catch (encErr) {
        // Result could not be serialized — surface it as an explicit failure
        // frame instead of dropping the reply entirely.
        frame = encodeResponse({
          id,
          ok: false,
          error: { message: `result not serializable: ${encErr.message || encErr}` },
        });
      }

      if (socket.destroyed || !socket.writable) {
        recordUndeliverable({ id, reason: 'socket destroyed before reply' });
        return false;
      }

      let flushed;
      try {
        flushed = socket.write(frame);
      } catch (writeErr) {
        recordUndeliverable({ id, reason: writeErr.message || String(writeErr) });
        return false;
      }

      if (flushed === false) {
        // Backpressure: wait for the kernel buffer to drain before treating the
        // reply as delivered. Bail honestly if the peer dies first.
        try {
          await new Promise((resolve, reject) => {
            const cleanup = () => {
              socket.removeListener('drain', onDrain);
              socket.removeListener('error', onErr);
              socket.removeListener('close', onClose);
            };
            const onDrain = () => {
              cleanup();
              resolve();
            };
            const onErr = (e) => {
              cleanup();
              reject(e);
            };
            const onClose = () => {
              cleanup();
              reject(new Error('socket closed before drain'));
            };
            socket.once('drain', onDrain);
            socket.once('error', onErr);
            socket.once('close', onClose);
          });
        } catch (drainErr) {
          recordUndeliverable({ id, reason: drainErr.message || String(drainErr) });
          return false;
        }
      }
      return true;
    };

    socket.on('data', async (chunk) => {
      const frames = parser.push(chunk);
      for (const f of frames) {
        // Pause the idle clock while we handle a frame so it can never fire
        // mid-call; it is re-armed only AFTER the reply has gone out.
        clearIdle();

        if (f.error) {
          await reply({ id: null, ok: false, error: { message: `malformed frame: ${f.error.message}` } });
          armIdle();
          continue;
        }
        const req = f.value;

        if (req.type === 'shutdown') {
          await reply({ id: req.id, ok: true, result: { stopping: true } });
          // Reply already flushed (awaited) — now tear down.
          setImmediate(() => stop().catch(() => {}));
          continue;
        }
        if (req.type === 'ping') {
          await reply({ id: req.id, ok: true, result: { pong: true, device } });
          armIdle();
          continue;
        }
        if (req.type === 'call') {
          inFlight += 1;
          try {
            const result = await call(req.tool, req.args || {});
            await reply({ id: req.id, ok: true, result });
          } catch (err) {
            await reply({ id: req.id, ok: false, error: { message: err.message || String(err) } });
          } finally {
            inFlight -= 1;
            armIdle(); // arm idle only after the reply has completed
          }
          continue;
        }
        await reply({ id: req.id, ok: false, error: { message: `unknown request type: ${req.type}` } });
        armIdle();
      }
    });

    socket.on('error', () => {
      sockets.delete(socket);
    });
    socket.on('close', () => {
      sockets.delete(socket);
    });
  });

  const socketPath = paths.socketPath(projectRoot);

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
  } catch (err) {
    // listen failed (e.g. EADDRINUSE from a double-spawn that beat us to the
    // bind, or a recycled-pid wedge). The connection was already built — close
    // it so we never leak the mobile-mcp child, and release the lock.
    try {
      await close();
    } catch (_) {
      /* best-effort */
    }
    releaseLock();
    throw err;
  }

  // Persist handle + pidfile now that we are actually listening.
  const handle = {
    pid: process.pid,
    device: device || null,
    socket: socketPath,
    started_at: new Date().toISOString(),
    idle_ms: idleMs,
  };
  fs.writeFileSync(paths.handlePath(projectRoot), JSON.stringify(handle, null, 2) + '\n');
  fs.writeFileSync(paths.pidFilePath(projectRoot), String(process.pid) + '\n');

  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);

  armIdle();

  return {
    socketPath,
    device: device || null,
    stop,
    // Replies that could not be delivered (peer gone / unflushable). Surfaced so
    // callers/tests can observe transport failures instead of them being eaten.
    undeliverable,
    // Resolves when the daemon has fully stopped (idle reap / signal / shutdown).
    whenStopped: new Promise((resolve) => {
      onStop = resolve;
    }),
  };
}

module.exports = { startDaemon, cleanStale, pidAlive, DEFAULT_IDLE_MS };
