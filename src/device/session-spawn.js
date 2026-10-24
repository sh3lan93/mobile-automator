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
const paths = require('./session-paths');
const sessionSalt = require('./session-salt');
const reaper = require('./process-reaper');

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
  // The engine the caller resolved (src/device/engine.js) and where it came
  // from (#251). The daemon passes `engine` to createCall and records both in
  // its handle, which is how a later verb spots a daemon on a stale engine.
  engine = null,
  engineSource = null,
  spawn = childProcess.spawn,
  readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
  pollMs = DEFAULT_POLL_MS,
  isAlive = sessionClient.isAlive,
  openLog = sessionLog.openDaemonLog,
  // Reads or creates the workspace's marker salt (#236). Injectable so the
  // spawn args are testable without a writable workspace.
  ensureSalt = sessionSalt.ensureSalt,
  // Kills a daemon that never became ready (#156). group:true reaches the
  // daemon AND its mobile-mcp engine: `detached: true` below makes the daemon
  // a process-group leader, and the engine is spawned into its group.
  terminate = (pid) => reaper.terminate(pid, { group: true }),
} = {}) {
  if (!projectRoot) throw new TypeError('spawnDaemon requires projectRoot');

  const env = { ...process.env, MAUTO_SESSION_PROJECT_ROOT: projectRoot };
  if (device) env.MAUTO_SESSION_DEVICE = device;
  if (idleMs !== undefined && idleMs !== null) env.MAUTO_SESSION_IDLE_MS = String(idleMs);
  // Never inherited: a value leaking in from the parent's env would make the
  // daemon record an engine nobody resolved for it.
  delete env.MAUTO_SESSION_ENGINE;
  delete env.MAUTO_SESSION_ENGINE_SOURCE;
  if (engine) env.MAUTO_SESSION_ENGINE = engine;
  if (engine && engineSource) env.MAUTO_SESSION_ENGINE_SOURCE = engineSource;

  // Must precede the spawn: the fd has to exist before the child can inherit it.
  // Never null — a workspace we cannot write to yields the `stdio: 'ignore'`
  // handle, so there is nothing to branch on here. The daemon writes its own
  // spawn banner (bin/mauto-session-daemon.js), which is why this file no
  // longer needs the child's pid.
  const log = openLog(projectRoot);

  try {
    // The workspace key in argv is an identity marker only (see paths.daemonArgv):
    // env stays the daemon's source of truth, but `ps` can only see argv. It is
    // salted with the workspace's own secret, so `ps` readers cannot confirm a
    // guessed path by hashing it (#236). A salt we can neither read nor create
    // leaves the marker off rather than failing the spawn: `session end` then
    // reports that daemon instead of group-killing it, the safe direction. No
    // argument names the project path, since `ps` shows argv to every user on
    // the host (#236): an in-project bin is passed relative to the root
    // (paths.argvPath), which only resolves because the child's cwd IS that
    // root. One `cwd` feeds both, so the two cannot drift apart.
    // cwd: the engine inherits the daemon's cwd, and mobile-mcp's
    // validateOutputPath only allows screenshots under its own process.cwd()
    // (or the temp dir). Pin it to the project root so the allow-list never
    // depends on which subdirectory happened to spawn the daemon (#214).
    let marker = [];
    try {
      marker = paths.daemonArgv(projectRoot, ensureSalt(projectRoot));
    } catch (err) {
      log.write(`mauto: could not create the session marker salt; daemon spawned without a workspace marker: ${err && err.message ? err.message : err}\n`);
    }
    const cwd = projectRoot;
    const child = spawn(process.execPath, [paths.argvPath(cwd, DAEMON_BIN), ...marker], {
      cwd,
      detached: true,
      stdio: log.stdio,
      env,
    });

    // A spawn that fails to exec (EMFILE, EACCES, ENOENT on the bin) emits an
    // 'error' event instead of throwing. Without a listener that error would
    // crash the one-shot verb process; with it we bail out of the readiness
    // poll immediately instead of waiting out the full 15s window for a child
    // that can never come up. No 'exit' short-circuit here: a loser exiting
    // ELOCKED is expected, and the winner may still come up within the window.
    //
    // The error is also WRITTEN to the log, not just used as a flag: a child
    // that never execs has no stdout/stderr of its own, so the parent is the
    // only witness. Dropping it here would rebuild the exact hole #163 fixes,
    // one layer up.
    let spawnError = null;
    if (child && typeof child.on === 'function') {
      child.on('error', (err) => {
        spawnError = err;
        log.write(`mauto: daemon spawn failed: ${err && err.stack ? err.stack : err}\n`);
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

    // Not ready in time. Without this the child lives on — typically still
    // inside createCall, holding the O_EXCL lock — and every later verb burns
    // its own readiness window against it (#156). Only OUR child, and only if
    // it is still running: an ELOCKED spawn-race loser has already exited and
    // must never signal anything. Node tracked this exact child, so its state
    // needs no pidIdentity check and has no pid-reuse window.
    if (child && child.pid && child.exitCode === null && child.signalCode === null) {
      const outcome = await terminate(child.pid);
      // The parent is the only witness to this kill — write it down (#163).
      log.write(`mauto: daemon not ready after ${readyTimeoutMs}ms; terminated pid=${child.pid} (${outcome})\n`);
    }
    return false;
  } finally {
    // The child holds its own dup, so the parent releases its descriptor rather
    // than leaking one per verb invocation. In `finally` because the 'error'
    // listener above fires asynchronously — the handle has to outlive the poll.
    log.close();
  }
}

module.exports = { spawnDaemon, DAEMON_BIN, DEFAULT_READY_TIMEOUT_MS };
