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
//   - the socket itself is held to SOCKET: a real socket, not a link, owned
//     by us, no override (D-d). Before connecting, the client asks
//     verifySocket. It never throws: a socket that fails any check reads as
//     "no daemon here", so the verb starts its own instead of talking to
//     someone else's.
//   - the daemon binds through listenOwnerOnly, so the socket is never usable
//     by another user, even between the bind and the chmod.
//
// The checks themselves are safe-fs's generic primitives (checkDir, safeDir,
// isOwnLeaf); the policies and their wording are this module's.

const fs = require('fs');

const paths = require('./session-paths');
const { WORKSPACE_DIR, dirPolicy, checkDir, safeDir, isOwnLeaf } = require('../workspace/safe-fs');

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

// The socket leaf: never the override (D-d).
const SOCKET = Object.freeze({ type: 'socket', trustOverride: false });

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

// Is `file` a real socket, not a link, owned by us whatever
// MAUTO_TRUST_WORKSPACE_OWNER says? False when nothing is there; any other fs
// error propagates. Its directory is the caller's to check first.
function isOwnSocket(file, deps = {}) {
  return isOwnLeaf(file, SOCKET, deps);
}

// May the client connect to this workspace's socket? Returns the socket path
// only when its directory is private (.session/ under SESSION_DIR through a
// link-free walk, or the fallback directory under SOCKET_DIR) and the socket is
// our own; that path is the ONE the client then connects to, so it never
// connects anywhere it did not check. Any failure, including a missing socket,
// is null.
function verifySocket(projectRoot, deps = {}) {
  try {
    const { file, dir, inWorkspace } = paths.socketLocation(projectRoot, deps);
    if (inWorkspace) safeDir(projectRoot, dir, { policy: SESSION_DIR }, deps);
    else checkDir(dir, SOCKET_DIR, {}, deps);
    return isOwnSocket(file, deps) ? file : null;
  } catch (_) {
    return null;
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

module.exports = { ensureSessionDir, ensureSessionDirs, isOwnSocket, verifySocket, listenOwnerOnly };
