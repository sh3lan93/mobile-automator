'use strict';

// Process identity for the device session lifecycle (#156): is a pid alive,
// is it a zombie awaiting a reaper, is it OUR daemon, and which pid does a
// pid/lock file name. A leaf module on purpose — session-daemon.js (cleanStale),
// process-reaper.js (its waits) and connection.js (`session end`) all ask these
// questions, and none of them should have to load the daemon to do so.
//
// Every effect that can fail on a slim host (`ps`, /proc) is injectable, so the
// classification is unit-testable against a fake process table.

const childProcess = require('child_process');
const fs = require('fs');

const paths = require('./session-paths');
const sessionSalt = require('./session-salt');

// True when a pid is a live process we own. ESRCH => dead; EPERM => alive.
// cleanStale routes through pidIdentity, which also checks the process's
// identity (not just liveness).
function pidAlive(pid) {
  if (!pid || !Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

// Has `pid` exited and is only awaiting a parent to reap it? kill(pid, 0)
// succeeds on a zombie, so pidAlive alone calls an exited process alive (#156).
// That is the normal end state of a daemon wherever PID 1 does not reap
// adopted orphans — Docker without --init, CI job containers whose PID 1 is
// `tail -f /dev/null`, a Node agent host running as PID 1 — because the
// detached daemon is reparented to it when the verb that spawned it exits.
// Any failure to tell answers "not a zombie", so liveness decides as before.
// Used by process-reaper.js's waits; lives here, beside pidAlive and
// pidIdentity, because this is the module that runs `ps`.
function isZombie(
  pid,
  { platform = process.platform, readFile = fs.readFileSync, execFile = childProcess.execFileSync } = {}
) {
  try {
    if (platform === 'linux') {
      // "pid (comm) S ..." — comm may itself contain spaces or ')', so the state
      // is the field after the LAST ')'. Reading /proc needs no `ps`, which
      // slim container images do not ship.
      const stat = String(readFile(`/proc/${pid}/stat`, 'utf8'));
      return /^\s*[ZX]/.test(stat.slice(stat.lastIndexOf(')') + 1));
    }
    const out = execFile('ps', ['-o', 'stat=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return /^\s*Z/.test(String(out));
  } catch (_) {
    return false;
  }
}

// Classify a pid by liveness AND identity. Liveness alone is not enough: a
// recycled pid (an unrelated process that inherited the dead daemon's pid) is
// "alive" but is NOT our daemon, so a stale lock/pidfile pointing at it must be
// cleaned rather than respected. Returns one of:
//   'dead'    - no such process (ESRCH or any non-EPERM kill error)
//   'ours'    - alive AND its command line contains `mauto-session-daemon`
//               (and, when `projectRoot` is given, names THAT workspace)
//   'foreign' - only with `projectRoot`: alive and a mauto daemon whose
//               command line carries a workspace marker naming ANOTHER
//               workspace (#156) — or this one's under a salt we cannot read.
//               Never ours to signal.
//   'unmarked'- only with `projectRoot`: alive and a mauto daemon whose command
//               line carries no workspace marker at all (#237) — one started by
//               mauto <= 0.27.x, or an editor open on the bin. Its line cannot
//               prove whose it is either way, so `session end` never signals
//               it and reports it 'unproven' (#344, src/device/session-end.js).
//   'other'   - alive AND its command line does NOT (recycled pid)
//   'unknown' - alive but `ps` itself failed (e.g. no `ps` on the host) —
//               treated as 'ours' by cleanStale: never clean when unsure.
// `execFile` is injectable for tests; a failure there must never crash the
// daemon, hence the 'unknown' fallback. So is `readSalt` (#236): the marker is
// HMAC(salt, root), and the salt is read from THIS workspace's .session/, only
// when a projectRoot is given. A copied workspace has the salt but not the
// root, so the original's daemon stays 'foreign' to it.
//
// cleanStale passes no projectRoot and keeps the binary-level answer: there a
// wrong 'ours' only means stale files are left alone. `session end` passes one,
// because there a wrong 'ours' sends a process-group kill (src/device/connection.js).
function pidIdentity(
  pid,
  { execFile = childProcess.execFileSync, projectRoot = null, readSalt = sessionSalt.readSalt } = {}
) {
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
    // -ww: never truncate the line — the workspace marker is at its END. stderr
    // ignored: a failing `ps` is already the 'unknown' answer, not verb output.
    const out = String(
      execFile('ps', ['-ww', '-p', String(pid), '-o', 'command='], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }) || ''
    );
    if (!/mauto-session-daemon/.test(out)) return 'other';
    if (projectRoot == null) return 'ours';
    if (paths.commandNamesWorkspace(out, projectRoot, readSalt(projectRoot))) return 'ours';
    return paths.commandHasWorkspaceMarker(out) ? 'foreign' : 'unmarked';
  } catch (_) {
    return 'unknown';
  }
}

// The most a pid/lock file is read for: a pid plus a newline fits many times
// over, and a planted multi-gigabyte file costs nothing.
const PID_FILE_MAX_BYTES = 32;

// Read a pid out of a one-line pid/lock file, or null when absent/garbage.
// Both files live in the workspace, which may be checked in or planted (#344),
// so the read never follows a symlink (O_NOFOLLOW), never blocks on a FIFO
// (O_NONBLOCK), and accepts only a regular file: anything else reads as absent.
function readPidFile(file) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    if (!fs.fstatSync(fd).isFile()) return null;
    const buf = Buffer.alloc(PID_FILE_MAX_BYTES);
    const n = fs.readSync(fd, buf, 0, PID_FILE_MAX_BYTES, null);
    const pid = parseInt(buf.toString('utf8', 0, n).trim(), 10);
    return Number.isInteger(pid) ? pid : null;
  } catch (_) {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch (_) {
        // already closed or invalid: nothing to release
      }
    }
  }
}

module.exports = { pidAlive, isZombie, pidIdentity, readPidFile };
