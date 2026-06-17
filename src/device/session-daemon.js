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

// Remove a stale socket/pidfile/handle left by a crashed daemon so a fresh
// daemon can bind. If a pidfile points at a LIVE process we leave things alone
// and signal the caller (the listen() will then EADDRINUSE, surfacing the
// conflict rather than hijacking a healthy daemon).
function cleanStale(projectRoot) {
  const pidFile = paths.pidFilePath(projectRoot);
  let livePid = null;
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    if (pidAlive(pid)) livePid = pid;
  } catch (_) {
    /* no pidfile */
  }
  if (livePid) return { cleaned: false, livePid };

  safeUnlink(paths.socketPath(projectRoot));
  safeUnlink(pidFile);
  safeUnlink(paths.handlePath(projectRoot));
  return { cleaned: true, livePid: null };
}

async function startDaemon({
  projectRoot,
  device = null,
  idleMs = DEFAULT_IDLE_MS,
  createCall = defaultCreateCall,
} = {}) {
  if (!projectRoot) throw new TypeError('startDaemon requires projectRoot');

  const dir = paths.sessionDir(projectRoot);
  fs.mkdirSync(dir, { recursive: true });

  // Reap a crashed daemon's leftovers before we bind.
  cleanStale(projectRoot);

  // Build the single shared connection up front.
  const { call, close } = await createCall({ device });

  let idleTimer = null;
  let stopping = false;
  const sockets = new Set();
  let onStop = null; // resolves stop()'s promise

  const server = net.createServer();

  function clearIdle() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function armIdle() {
    clearIdle();
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

    const reply = (obj) => {
      try {
        socket.write(encodeResponse(obj));
      } catch (_) {
        /* peer gone */
      }
    };

    socket.on('data', async (chunk) => {
      const frames = parser.push(chunk);
      for (const f of frames) {
        if (f.error) {
          reply({ id: null, ok: false, error: { message: `malformed frame: ${f.error.message}` } });
          continue;
        }
        const req = f.value;
        armIdle(); // any request resets the idle clock

        if (req.type === 'shutdown') {
          reply({ id: req.id, ok: true, result: { stopping: true } });
          // Let the reply flush, then tear down.
          setImmediate(() => stop().catch(() => {}));
          continue;
        }
        if (req.type === 'ping') {
          reply({ id: req.id, ok: true, result: { pong: true, device } });
          continue;
        }
        if (req.type === 'call') {
          try {
            const result = await call(req.tool, req.args || {});
            reply({ id: req.id, ok: true, result });
          } catch (err) {
            reply({ id: req.id, ok: false, error: { message: err.message || String(err) } });
          }
          continue;
        }
        reply({ id: req.id, ok: false, error: { message: `unknown request type: ${req.type}` } });
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

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

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
    // Resolves when the daemon has fully stopped (idle reap / signal / shutdown).
    whenStopped: new Promise((resolve) => {
      onStop = resolve;
    }),
  };
}

module.exports = { startDaemon, cleanStale, pidAlive, DEFAULT_IDLE_MS };
