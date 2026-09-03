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

const childProcess = require('child_process');
const fs = require('fs');
const net = require('net');

const paths = require('./session-paths');
const { FrameParser } = require('./session-protocol');
const { newSessionId } = require('./session-handle');
const { makeDeviceCall } = require('./device-call');

const DEFAULT_IDLE_MS = 5 * 60 * 1000;

// Per-call timeout for the shared mobile-mcp connection. Deliberately BELOW the
// client's DEFAULT_TIMEOUT_MS (30000) so the daemon's timeout error always wins
// the race and reaches the client as an honest {kind:'timeout'} reply instead of
// being dropped by the client's own 30s timeout (which would look like a
// false-failure and prompt a retry → double-execution on the device). The
// structural invariant CLIENT_TIMEOUT > DAEMON_CALL_TIMEOUT is pinned by
// tests/unit/device/timeout-invariant.test.js.
const DAEMON_CALL_TIMEOUT_MS = 25000;

// Resolves after `ms` without keeping the process alive. Injectable so tests
// can drive the timeout path without waiting 25s.
function defaultScheduleTimeout(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof t.unref === 'function') t.unref();
  });
}

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
// Kept exported for back-compat; cleanStale routes through pidIdentity, which
// also checks the process's identity (not just liveness).
function pidAlive(pid) {
  if (!pid || !Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

// Classify a pid by liveness AND identity. Liveness alone is not enough: a
// recycled pid (an unrelated process that inherited the dead daemon's pid) is
// "alive" but is NOT our daemon, so a stale lock/pidfile pointing at it must be
// cleaned rather than respected. Returns one of:
//   'dead'    - no such process (ESRCH or any non-EPERM kill error)
//   'ours'    - alive AND its command line contains `mauto-session-daemon`
//   'other'   - alive AND its command line does NOT (recycled pid)
//   'unknown' - alive but `ps` itself failed (e.g. no `ps` on the host) —
//               treated as 'ours' by cleanStale: never clean when unsure.
// `execFile` is injectable for tests; a failure there must never crash the
// daemon, hence the 'unknown' fallback.
function pidIdentity(pid, { execFile = childProcess.execFileSync } = {}) {
  if (!pid || !Number.isInteger(pid)) return 'dead';
  // Our own pid is the in-process daemon (unit tests run startDaemon in the
  // test process, so the lock/pidfile carry the test runner's pid). Never clean
  // files that point at ourselves. In production cleanStale runs before the
  // daemon writes its own pid/lock, so this branch only fires in-process.
  if (pid === process.pid) return 'ours';
  let alive;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch (err) {
    if (err.code === 'EPERM') alive = true;
    else return 'dead';
  }
  if (!alive) return 'dead';
  try {
    const out = execFile('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
    return /mauto-session-daemon/.test(String(out || '')) ? 'ours' : 'other';
  } catch (_) {
    return 'unknown';
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
// daemon can bind. Identity is decided from the LOCK file first (acquired before
// the connection is built, so it covers a daemon still mid-startup) then the
// pidfile (written once listening). If either points at a LIVE process that is
// OURS (or unclassifiable — 'unknown') we leave everything alone and signal the
// caller — the lock's O_EXCL or the listen() EADDRINUSE then surfaces the
// conflict rather than hijacking a healthy daemon. A pid that is alive but NOT
// ours ('other') is a RECYCLED pid: the daemon that wrote it is long dead and an
// unrelated process inherited the number, so the stale files are cleaned instead
// of wedging every spawn for the lifetime of that unrelated process.
function cleanStale(projectRoot, { execFile } = {}) {
  const pidFile = paths.pidFilePath(projectRoot);
  const lockFile = paths.lockPath(projectRoot);
  let livePid = null;
  for (const f of [lockFile, pidFile]) {
    const pid = readPidFile(f);
    if (!pid) continue;
    const id = pidIdentity(pid, { execFile });
    if (id === 'dead') continue; // keep scanning; ultimately clean
    if (id === 'ours' || id === 'unknown') {
      livePid = pid;
      break;
    }
    // id === 'other' → recycled pid → fall through to the safeUnlinks.
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
  scheduleTimeout = defaultScheduleTimeout,
  execFile = childProcess.execFileSync,
  sessionId = newSessionId(),
  // Structured observability, injected rather than defaulted to the real
  // recorder for one reason: startDaemon also runs IN-PROCESS across ~40 unit
  // tests, where a live stderr sink would write into jest's reporter output.
  // The only process that is actually a daemon — bin/mauto-session-daemon.js —
  // injects the real recorder, and tests/unit/bin/mauto-session-daemon-observe
  // .test.js proves it does.
  observe = () => {},
} = {}) {
  if (!projectRoot) throw new TypeError('startDaemon requires projectRoot');

  // Observability must never be load-bearing. `observe` is injected, so a
  // caller-supplied sink that throws must not take the daemon — and the device
  // session — down with it. The production recorder is already total; this
  // makes that a property of the DAEMON rather than of its current caller,
  // which matters because the seam exists precisely so that something other
  // than the default gets passed. Wrapped once, here, rather than at each call
  // site: a guarantee you have to remember to re-apply is not a guarantee.
  //
  // Two failure modes this closes, both proved by
  // tests/unit/device/daemon-observability.test.js: the daemon dying at startup
  // killed by the code whose only job is to explain why daemons die, and — on
  // the failure paths, which observe BEFORE releaseLock() — a telemetry fault
  // masking the real error and leaking the lock, wedging every later spawn.
  const safeObserve = (fields) => {
    try {
      observe(fields);
    } catch (_) {
      /* an observability fault is never worth a device session */
    }
  };

  // Zero point for every dur_ms this daemon reports: startup duration on
  // daemon.start, total session lifetime on daemon.stop.
  const startedAtMs = Date.now();

  const dir = paths.sessionDir(projectRoot);
  fs.mkdirSync(dir, { recursive: true });

  // Reap a crashed daemon's leftovers before we bind.
  cleanStale(projectRoot, { execFile });

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
      // warn, not error: a spawn-race loser failing here is the lock DOING ITS
      // JOB. It is worth seeing (a workspace where it repeats means two agents
      // are fighting over one device) but it is not a malfunction.
      safeObserve({ level: 'warn', event: 'daemon.lock_conflict', error_code: 'ELOCKED', pid: process.pid });
      const e = new Error('device session daemon already starting for this workspace (lock held)');
      e.code = 'ELOCKED';
      throw e;
    }
    // Not a race — EACCES, EROFS, ENOSPC on .session/. An invisible death that
    // nothing else in the system reports.
    safeObserve({
      level: 'error',
      event: 'daemon.start_failure',
      error_code: err && err.code,
      message: err && (err.message || String(err)),
      pid: process.pid,
    });
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
    // #156's core symptom: mobile-mcp never came up, and until now the only
    // trace was a 15s readiness timeout in the spawning verb.
    safeObserve({
      level: 'error',
      event: 'daemon.connect_failure',
      error_code: err && err.code,
      message: err && (err.message || String(err)),
      dur_ms: Date.now() - startedAtMs,
      pid: process.pid,
    });
    releaseLock();
    throw err;
  }

  // One bounded, measured call, built ONCE and shared by every connection: the
  // timeout, the sink and the connection are all per-daemon, so nothing about
  // it is per-socket. Built HERE, before server.listen() below, or the first
  // frame to arrive would hit a temporal dead zone.
  //
  // safeObserve, never the raw `observe`. call.start now fires BEFORE call(),
  // so a sink that throws would mean the device action never happens at all —
  // observability deciding whether a tap occurs. The wrapper at :178-193 is the
  // one place that guarantee lives; device-call.js is deliberately unguarded
  // and lets a throwing observe propagate, so passing the raw seam here would
  // quietly undo it.
  const invoke = makeDeviceCall(call, {
    scheduleTimeout,
    observe: safeObserve,
    timeoutMs: DAEMON_CALL_TIMEOUT_MS,
  });

  let idleTimer = null;
  let stopping = false;
  let inFlight = 0; // device calls whose reply has not yet been sent
  const sockets = new Set();
  const undeliverable = []; // replies we could not deliver (peer gone / unflushable)
  let onStop = null; // resolves stop()'s promise

  const notifyUndeliverable =
    typeof onUndeliverable === 'function'
      ? onUndeliverable
      : (info) =>
          // Was a bespoke process.stderr.write with its own try/catch. It is
          // the same destination — the stderr sink writes to fd 2, which since
          // #176 IS mobile-automator/.session/daemon.log — but now structured,
          // and safeObserve (plus record()'s own never-throw guarantee)
          // subsumes the hand-rolled guard. That guard mattered: this runs
          // inside reply(), on the socket's async data handler, so a throw here
          // would surface as an unhandled rejection. The frame id and the
          // transport reason go in `message`, which is sends:false: a socket
          // errno is free text and free text never reaches the telemetry path.
          safeObserve({
            level: 'warn',
            event: 'daemon.undeliverable',
            message: `id=${info.id}: ${info.reason}`,
          });

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
        stop('idle').catch(() => {});
      }, idleMs);
      if (typeof idleTimer.unref === 'function') idleTimer.unref();
    }
  }

  async function stop(reason = 'explicit') {
    if (stopping) return;
    stopping = true;
    clearIdle();

    // Recorded HERE, before the drain, not after teardown. stop() can block on
    // an in-flight device call and on close()ing a mobile-mcp child that will
    // not die — the two hangs most worth seeing — and an event written after
    // them would never be written at all. The `if (stopping) return` above is
    // what keeps this to one event per daemon.
    safeObserve({
      level: 'info',
      event: 'daemon.stop',
      stop_reason: reason,
      pid: process.pid,
      dur_ms: Date.now() - startedAtMs,
    });

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
    stop('signal').catch(() => {});
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
        frame = FrameParser.encode(obj);
      } catch (encErr) {
        // Result could not be serialized — surface it as an explicit failure
        // frame instead of dropping the reply entirely.
        frame = FrameParser.encode({
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
          setImmediate(() => stop('shutdown').catch(() => {}));
          continue;
        }
        if (req.type === 'ping') {
          await reply({ id: req.id, ok: true, result: { pong: true, device, in_flight: inFlight } });
          armIdle();
          continue;
        }
        if (req.type === 'call') {
          // A call that arrives after stop() began must be rejected up front:
          // it never started, so it must not block stop()'s drain (inFlight is
          // only decremented for calls that actually incremented it).
          if (stopping) {
            await reply({
              id: req.id,
              ok: false,
              error: { message: 'session daemon is shutting down', kind: 'device' },
            });
            armIdle();
            continue;
          }
          // inFlight/armIdle stay HERE, not in the decorator: they gate stop()'s
          // drain and are reported by ping/getSessionStatus, which are facts
          // about the daemon's sockets rather than about one device call.
          inFlight += 1;
          try {
            const result = await invoke(req.tool, req.args || {});
            await reply({ id: req.id, ok: true, result });
          } catch (err) {
            // Only a timeout carries kind/hint outward; a non-timeout failure
            // drops both so client/deviceFail defaults to 'device'. Do NOT
            // "simplify" this to `kind: err && err.kind`: that would forward an
            // engine-invented kind that exitCodeFor does not enumerate (turning
            // a device failure's exit 2 into exit 1) and would emit "kind":null
            // for a falsy rejection. daemon-timeout.test.js pins both.
            const timedOut = Boolean(err && err.kind === 'timeout');
            await reply({
              id: req.id,
              ok: false,
              error: {
                message: err && (err.message || String(err)),
                kind: timedOut ? 'timeout' : undefined,
                hint: timedOut ? err.hint : undefined,
              },
            });
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
    safeObserve({
      level: 'error',
      event: 'daemon.listen_failure',
      error_code: err && err.code,
      message: err && (err.message || String(err)),
      dur_ms: Date.now() - startedAtMs,
      pid: process.pid,
    });
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
    // Correlates every event from this daemon lifetime, which run_id cannot:
    // it lives in the handle so a verb reads it from a file that is already
    // there instead of paying a socket round trip (src/device/session-handle.js).
    session_id: sessionId,
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

  // Recorded after the handle exists, so anything reading the log can also read
  // the handle it names. device_id is sends:false — a device serial never
  // leaves the machine.
  safeObserve({
    level: 'info',
    event: 'daemon.start',
    pid: process.pid,
    device_id: device || undefined,
    dur_ms: Date.now() - startedAtMs,
  });

  return {
    socketPath,
    device: device || null,
    sessionId,
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

module.exports = { startDaemon, cleanStale, pidAlive, pidIdentity, DAEMON_CALL_TIMEOUT_MS, DEFAULT_IDLE_MS };
