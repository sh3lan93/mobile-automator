'use strict';

// The device session's directories and socket: the policies they are held to,
// what a refusal of one says, and where each check applies (#346).
//
// The session socket is the daemon's whole interface: anything that can bind
// it first, or swap it for a link, receives every device call a verb sends,
// and can answer them. Node exposes no peer credentials for a Unix socket, so
// the guarantee is the filesystem's: the socket is only ever reached through
// a directory no other user can enter, and is itself ours.
//
//   - .session/ is held to SESSION_DIR: 0700-tight, the owner override still
//     applying, as anywhere in the workspace. ensureSessionDir makes it so,
//     tightening one an older mauto created at 0755.
//   - a root too deep for an in-workspace socket uses the per-user fallback
//     (session-paths.js privateSocketDir), held to SOCKET_DIR: a real 0700
//     directory of ours, whatever MAUTO_TRUST_WORKSPACE_OWNER says (D-d).
//     ensureSessionDirs adds it.
//   - the socket itself must be a real socket, not a link, owned by us, with
//     no override (D-d): isOwnSocket. The client connects only through
//     connectPinned, which runs these checks and then connects through the
//     very directory it checked (#361). A socket that fails any check reads
//     as "no daemon here", so the verb starts its own instead of talking to
//     someone else's.
//   - the daemon binds through listenOwnerOnly, so the socket is never usable
//     by another user, even between the bind and the chmod.
//
// The directory checks are safe-fs's generic primitives (checkDir, safeDir);
// the policies, their wording and the socket check are this module's.

const fs = require('fs');
const path = require('path');

const paths = require('./session-paths');
const { parseSalt } = require('./session-salt');
const { UnsafePathError, WORKSPACE_DIR, dirPolicy, checkDir, safeDir, readOwnedLeaf } = require('../workspace/safe-fs');

// .session/: a workspace directory, so it keeps the workspace wording and the
// owner override (a CI checkout owned by another uid), but no group or other
// bit may be set.
const SESSION_DIR = dirPolicy({
  ...WORKSPACE_DIR,
  hints: {
    ...WORKSPACE_DIR.hints,
    not_private:
      'Only the user running mauto may use it. Run chmod 700 <path>, or delete it and let mauto recreate it.',
  },
  forbiddenBits: 0o077,
  modeReason: 'not_private',
});

// The fallback socket directory, outside the workspace, in the temp dir. The workspace hints point the wrong way there, and the
// owner override they offer never applies, so it has wording of its own; only
// the reasons it can raise have a hint. The daemon prints a refusal's hint
// under its message in daemon.log.
const SOCKET_DIR_RECREATE = 'Remove it, and mauto recreates the directory 0700.';
const SOCKET_DIR = dirPolicy({
  subject: 'session socket directory',
  hints: {
    symlink: `mauto never follows a link for the session socket's directory. ${SOCKET_DIR_RECREATE}`,
    not_directory: SOCKET_DIR_RECREATE,
    foreign_owner:
      'Another user owns it, so mauto will not trust a socket there. Remove it (its owner or root may have to), and mauto recreates it 0700.',
    not_private:
      "Other users could reach the device session's socket through it. Run chmod 700 <path>, or remove it and let mauto recreate it 0700.",
  },
  fallbackHint: SOCKET_DIR_RECREATE,
  trustOverride: false,
  forbiddenBits: 0o077,
  modeReason: 'not_private',
});

// Create (or tighten, from the 0755 an older mauto made) .session/ alone, and
// return only once it is proven link-free and 0700. The walk makes it 0700
// when missing; the chmod tightens an existing one. chmod follows links, so a
// component swapped for a link between the walk and the chmod sends the chmod
// to the link's target (one only someone who can write the workspace could
// plant); the second walk, under SESSION_DIR, then refuses the swap, so this
// never returns on the strength of a chmod that went elsewhere or changed
// nothing. Throws UnsafePathError on a refused path, or the fs error. `deps`
// ({ fs, getuid, env }) reaches safe-fs unchanged.
//
// The daemon log needs only this: it lives in .session/ whatever the socket
// does, and must survive a refused fallback directory, because that refusal
// fails the daemon's start and the log is where the user is sent.
function ensureSessionDir(projectRoot, deps = {}) {
  const dir = paths.sessionDir(projectRoot);
  safeDir(projectRoot, dir, { create: true, mode: 0o700 }, deps);
  (deps.fs || fs).chmodSync(dir, 0o700);
  safeDir(projectRoot, dir, { policy: SESSION_DIR }, deps);
}

// .session/ and, for a deep root, the fallback socket directory: everything
// the daemon needs before it binds. The fallback is made 0700 when missing
// (only that level; its parent must exist) and never chmodded: we only ever
// create it 0700, so a looser mode means someone changed it, and that is
// refused rather than repaired. Returns the socket path whose directory it
// prepared: the ONE path the daemon binds, unlinks and records in its handle,
// so it never binds somewhere it did not check. Throws like ensureSessionDir;
// `deps` also reaches session-paths.
function ensureSessionDirs(projectRoot, deps = {}) {
  ensureSessionDir(projectRoot, deps);
  const { file, dir, inWorkspace } = paths.socketLocation(projectRoot, deps);
  if (!inWorkspace) checkDir(dir, SOCKET_DIR, { create: true, mode: 0o700 }, deps);
  return file;
}

// Is `file` a real socket owned by us? An lstat, because open(2) refuses a
// socket. lstat describes a link itself, so a link is never a socket. The
// owner is compared outright: MAUTO_TRUST_WORKSPACE_OWNER never applies to the
// socket (D-d). False when nothing is there; any other fs error propagates.
// Its directory is the caller's to check first. `deps` ({ fs, getuid }) is for
// tests.
function isOwnSocket(file, { fs: f = fs, getuid = process.getuid } = {}) {
  let st;
  try {
    st = f.lstatSync(file);
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
  return st.isSocket() && st.uid === getuid();
}

// An expected refusal of a pinned directory or what is in it: an
// UnsafePathError, or a system error, whose `code` is an errno name (ENOENT,
// EACCES, ENOTDIR, ELOOP, EPERM, ...). Anything else is not a refusal and must
// never read as "no daemon": a TypeError or other bug, and Node's own
// argument errors, whose codes are ERR_* (ERR_INVALID_ARG_TYPE). Matched by
// shape, not instanceof Error: an fs error can come from another realm (jest).
const ERRNO_CODE = /^E[A-Z0-9]+$/;
function isRefusal(err) {
  return err instanceof UnsafePathError || (err != null && typeof err.code === 'string' && ERRNO_CODE.test(err.code));
}

// Run `fn` with the process inside `dir`, once '.' (the directory the
// process is now in, whatever it is called by then) checks out under
// `policy`, and return what `fn` returned. Null, with `fn` never run, when the
// directory cannot be entered or fails the check; null too when `fn` throws a
// refusal (isRefusal). Any other error propagates. The previous working
// directory is always restored first; a restore that fails is thrown, never
// swallowed, because every relative path after it would resolve somewhere
// else. What `fn` opened is the caller's to clean up when this throws.
// `deps` ({ fs, getuid, env }) reaches safe-fs.
//
// Why a chdir (#361): a directory checked by its path and then used by its
// path can be another directory by the second use, since a group-writable
// parent (safe-fs accepts one; umask 002) lets a group member rename it in
// between. Pinning the checked directory and using it through relative names
// closes that gap. Node has neither connectat(2) nor fchdir(2), and macOS's
// /dev/fd/N does not traverse directories, so the only handle on a directory
// is the working directory itself.
//
// The working directory is process-wide, so the window is kept fully
// synchronous: nothing between the chdir and the restore awaits, takes a
// callback or yields to the event loop, so no other JS runs inside it. What
// `fn` does must resolve its relative names synchronously too: safe-fs's
// *Sync calls, and net.createConnection on a Unix socket, which does its
// connect(2) inline (libuv) before returning. And no fs call that mauto
// started earlier can be in flight in the libuv thread pool, resolving a
// relative path against the pinned directory: src/ and bin/ use no async fs
// API at all (guarded by tests/lint/no-async-fs.test.js).
function inPinnedDir(dir, policy, fn, deps = {}) {
  let prev;
  try {
    prev = process.cwd();
    process.chdir(dir);
  } catch (err) {
    if (isRefusal(err)) return null;
    throw err;
  }
  try {
    try {
      checkDir('.', policy, {}, deps);
      return fn();
    } catch (err) {
      if (isRefusal(err)) return null;
      throw err;
    }
  } finally {
    process.chdir(prev);
  }
}

// The workspace salt, read by its relative name inside the pinned .session/
// (inPinnedDir): no link, a regular file of ours. Null when missing or empty.
function readPinnedSalt(deps) {
  return parseSalt(readOwnedLeaf(paths.SALT_NAME, {}, deps));
}

// Connect to `name` in the pinned directory when it is our own socket. The
// connection is started here, inside the window; the caller awaits it.
function connectOwnSocket(name, connect, deps) {
  return isOwnSocket(name, deps) ? connect(name) : null;
}

// Open a connection to this workspace's session socket, but only through
// directories the client checked, and with the salt the daemon must prove it
// holds (#346, #361). `connect(name)` opens the connection by the socket's
// relative name and must resolve that name before it returns: the client
// passes net.createConnection, which does (see inPinnedDir). Returns
// { socket, salt } (the socket still connecting)
// or null: no workspace, a directory that is not private, a socket that is
// not ours, or no salt. Throws only what inPinnedDir throws (a failed restore
// of the working directory, or an error that is not a refusal), with any
// socket it opened destroyed first.
//
// The path checks are the same as ever, as a prefilter, so every refusal
// (and the 0755 .session/ an older mauto made, which the daemon tightens)
// reads as before. Then each directory is pinned and used by relative names
// only (inPinnedDir):
//   - in-workspace: ONE pinned block in .session/ reads marker.salt, checks
//     the socket and connects, so the salt and the socket come from the same
//     directory, the one checked;
//   - fallback: the salt is read in a pinned .session/, then the socket is
//     checked and connected in the pinned fallback directory.
// The salt never comes from a second lookup by path (session-salt readSalt):
// that could read a salt from a different directory than the one checked.
function connectPinned(projectRoot, connect, deps = {}) {
  let loc;
  let sessionDir;
  try {
    loc = paths.socketLocation(projectRoot, deps);
    sessionDir = paths.sessionDir(projectRoot);
    safeDir(projectRoot, sessionDir, { policy: SESSION_DIR }, deps);
    if (!loc.inWorkspace) checkDir(loc.dir, SOCKET_DIR, {}, deps);
  } catch (_) {
    return null;
  }
  const name = path.basename(loc.file);
  // The socket connect opened, destroyed here when inPinnedDir throws after it
  // (a failed restore, or an error that is not a refusal).
  let opened = null;
  try {
    if (loc.inWorkspace) {
      return inPinnedDir(
        sessionDir,
        SESSION_DIR,
        () => {
          const salt = readPinnedSalt(deps);
          if (!salt) return null;
          const socket = (opened = connectOwnSocket(name, connect, deps));
          return socket ? { socket, salt } : null;
        },
        deps
      );
    }
    const salt = inPinnedDir(sessionDir, SESSION_DIR, () => readPinnedSalt(deps), deps);
    if (!salt) return null;
    return inPinnedDir(
      loc.dir,
      SOCKET_DIR,
      () => {
        const socket = (opened = connectOwnSocket(name, connect, deps));
        return socket ? { socket, salt } : null;
      },
      deps
    );
  } catch (err) {
    if (opened) opened.destroy();
    throw err;
  }
}

// Bind `server` to `socketPath` so no other user can use the socket, even for
// an instant. bind(2) makes the socket file 0777 minus the umask, and the
// directory being private is not the only guard (#346): listen() binds
// synchronously, so a 077 umask set around the call covers the bind. The umask
// is process-wide, so it is restored in a finally straight after. The chmod
// once listening pins 0600 whatever the platform made of the umask. Resolves
// once listening and 0600; rejects on a listen error, or on a failed chmod,
// with the server then still listening (server.listening), so the caller
// closes it and removes the socket.
function listenOwnerOnly(server, socketPath) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    const prevUmask = process.umask(0o077);
    try {
      server.listen(socketPath, () => {
        server.removeListener('error', reject);
        try {
          fs.chmodSync(socketPath, 0o600);
        } catch (chmodErr) {
          reject(chmodErr);
          return;
        }
        resolve();
      });
    } finally {
      process.umask(prevUmask);
    }
  });
}

module.exports = {
  SESSION_DIR,
  ensureSessionDir,
  ensureSessionDirs,
  isOwnSocket,
  inPinnedDir,
  connectPinned,
  listenOwnerOnly,
};
