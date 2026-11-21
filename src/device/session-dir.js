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

const path = require('path');

const paths = require('./session-paths');
const { safeDir, privateDir, checkOwner, resolveDeps } = require('../workspace/safe-fs');

function usesFallback(projectRoot, deps) {
  return paths.socketPath(projectRoot, deps) !== paths.workspaceSocketPath(projectRoot);
}

// Create (or tighten) .session/ alone. Throws UnsafePathError on a refused
// path, or the fs error. `deps` ({ fs, getuid, env }) reaches safe-fs
// unchanged. The daemon log needs only this: it lives in .session/ whatever
// the socket does, and must survive a refused fallback directory, because that
// refusal fails the daemon's start and the log is where the user is sent.
function ensureSessionDir(projectRoot, deps = {}) {
  const { fs } = resolveDeps(deps);
  const dir = paths.sessionDir(projectRoot);
  safeDir(projectRoot, dir, { create: true, mode: 0o700 }, deps);
  // safeDir accepts the 0755 an older mauto made (a workspace directory may be
  // group-readable); the session directory may not be, so tighten it here.
  fs.chmodSync(dir, 0o700);
}

// .session/ and, for a deep root, the fallback socket directory: everything
// the daemon needs before it binds. Throws like ensureSessionDir; `deps` also
// reaches session-paths.
function ensureSessionDirs(projectRoot, deps = {}) {
  ensureSessionDir(projectRoot, deps);
  if (usesFallback(projectRoot, deps)) privateDir(paths.privateSocketDir(deps), { create: true }, deps);
}

// May the client connect to this workspace's socket? True only when its
// directory is private (.session/ 0700 through a link-free walk, or the
// fallback directory 0700 and ours) and the socket is a real socket, not a
// link, owned by us. The owner override applies to the workspace directories
// only, never to the socket (D-d). Any failure, including a missing socket,
// is false.
function verifySocket(projectRoot, deps = {}) {
  try {
    const d = resolveDeps(deps);
    const sock = paths.socketPath(projectRoot, deps);
    if (usesFallback(projectRoot, deps)) {
      privateDir(path.dirname(sock), {}, deps);
    } else {
      safeDir(projectRoot, paths.sessionDir(projectRoot), { private: true }, deps);
    }
    const st = d.fs.lstatSync(sock);
    if (!st.isSocket()) return false;
    checkOwner(sock, st, d, { strict: true });
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { ensureSessionDir, ensureSessionDirs, verifySocket };
