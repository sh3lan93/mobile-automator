'use strict';

// The device session's directories, made and checked (#346).
//
// The session socket is the daemon's whole interface: anything that can bind
// it first, or swap it for a link, receives every device call a verb sends,
// and can answer them. Node exposes no peer credentials for a Unix socket, so
// the guarantee is the filesystem's: the socket is only ever reached through
// a directory no other user can enter.
//
//   - .session/ is 0700. ensureSessionDir makes it so, tightening one an
//     older mauto created at 0755; ensureSessionDirs adds the fallback below.
//   - a root too deep for an in-workspace socket uses the per-user fallback
//     (session-paths.js privateSocketDir), which must be a real 0700 directory
//     of ours, whatever MAUTO_TRUST_WORKSPACE_OWNER says.
//   - before connecting, the client asks verifySocket. It never throws: a
//     socket that fails any check reads as "no daemon here", so the verb
//     starts its own instead of talking to someone else's.
//
// Every check is safe-fs's; this module only says which apply where.

const fs = require('fs');

const paths = require('./session-paths');
const {
  PRIVATE_WORKSPACE_DIR,
  safeDir,
  privateDir,
  privateWorkspaceDir,
  isOwnSocket,
} = require('../workspace/safe-fs');

// Create (or tighten, from the 0755 an older mauto made) .session/ alone, and
// return only once it is proven link-free and 0700. Throws UnsafePathError on
// a refused path, or the fs error. `deps` ({ fs, getuid, env }) reaches safe-fs
// unchanged. The daemon log needs only this: it lives in .session/ whatever
// the socket does, and must survive a refused fallback directory, because that
// refusal fails the daemon's start and the log is where the user is sent.
function ensureSessionDir(projectRoot, deps = {}) {
  privateWorkspaceDir(projectRoot, paths.sessionDir(projectRoot), deps);
}

// .session/ and, for a deep root, the fallback socket directory: everything
// the daemon needs before it binds. Throws like ensureSessionDir; `deps` also
// reaches session-paths.
function ensureSessionDirs(projectRoot, deps = {}) {
  ensureSessionDir(projectRoot, deps);
  const { dir, inWorkspace } = paths.socketLocation(projectRoot, deps);
  if (!inWorkspace) privateDir(dir, { create: true }, deps);
}

// May the client connect to this workspace's socket? True only when its
// directory is private (.session/ 0700 through a link-free walk, or the
// fallback directory 0700 and ours) and the socket is a real socket, not a
// link, owned by us. The owner override applies to the workspace directories
// only, never to the socket (D-d). Any failure, including a missing socket,
// is false.
function verifySocket(projectRoot, deps = {}) {
  try {
    const { file, dir, inWorkspace } = paths.socketLocation(projectRoot, deps);
    if (inWorkspace) safeDir(projectRoot, dir, { policy: PRIVATE_WORKSPACE_DIR }, deps);
    else privateDir(dir, {}, deps);
    return isOwnSocket(file, deps);
  } catch (_) {
    return false;
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

module.exports = { ensureSessionDir, ensureSessionDirs, verifySocket, listenOwnerOnly };
