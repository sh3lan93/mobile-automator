'use strict';

// Pure path helpers for the per-workspace device session daemon.
//
// Everything lives under <projectRoot>/.mobile-automator/.session/:
//   mauto.sock    — Unix domain socket the daemon listens on
//   daemon.pid    — pidfile written once the daemon is listening
//   session.json  — handle describing the live session (device pin, socket, pid)
//   daemon.log    — bounded stdout/stderr capture from the detached daemon
//   marker.salt   — per-workspace secret salting the daemon's argv marker
//                   (#236); created once (session-salt.js), never rotated or
//                   deleted by any teardown
//
// These are intentionally side-effect-free so they can be unit-tested without
// touching the filesystem. argvPath is the one exception: it reads realpaths,
// but never writes.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WORKSPACE_DIRNAME } = require('../workspace/dirname');

const SESSION_DIRNAME = '.session';
const SOCKET_NAME = 'mauto.sock';
const PID_NAME = 'daemon.pid';
const HANDLE_NAME = 'session.json';
const LOCK_NAME = 'daemon.lock';
const LOG_NAME = 'daemon.log';
const SALT_NAME = 'marker.salt';

// Unix domain socket paths have a hard length limit (~104 bytes on macOS,
// ~108 on Linux). Deep project roots blow past it, so when the in-workspace
// path would be too long we fall back to a short, deterministic socket path in
// the OS temp dir keyed by a hash of the project root. pidfile + handle always
// stay in the workspace (per-workspace ownership), and the handle records the
// actual socket path it bound.
const SOCKET_PATH_LIMIT = 100;

function sessionDir(projectRoot) {
  return path.join(projectRoot, WORKSPACE_DIRNAME, SESSION_DIRNAME);
}

// The canonical in-workspace socket path. Used when short enough.
function workspaceSocketPath(projectRoot) {
  return path.join(sessionDir(projectRoot), SOCKET_NAME);
}

// The path the daemon binds and the client connects to. Deterministic from the
// project root so both sides agree without reading the handle.
function socketPath(projectRoot) {
  const inWorkspace = workspaceSocketPath(projectRoot);
  if (Buffer.byteLength(inWorkspace) <= SOCKET_PATH_LIMIT) return inWorkspace;
  return path.join(os.tmpdir(), `mauto-${workspaceKey(projectRoot)}.sock`);
}

// A short, deterministic name for a workspace: the first 16 hex chars of
// sha1(resolved project root). It names ONLY the tmpdir socket fallback above.
// It is unsalted, so anyone who guesses the root can compute it; the daemon's
// argv marker uses daemonMarkerKey below instead (#236). Changing it moves the
// socket a running daemon is bound to, so its output is pinned by tests.
function workspaceKey(projectRoot) {
  return crypto.createHash('sha1').update(path.resolve(projectRoot)).digest('hex').slice(0, 16);
}

// Deliberately has no os.tmpdir() fallback, unlike socketPath(). That fallback
// exists solely because Unix domain socket paths hit a ~104-byte sockaddr
// limit; a regular file has no such limit, so the log stays in the workspace
// unconditionally and is always findable next to the session it describes.
function logFilePath(projectRoot) {
  return path.join(sessionDir(projectRoot), LOG_NAME);
}

function pidFilePath(projectRoot) {
  return path.join(sessionDir(projectRoot), PID_NAME);
}

function handlePath(projectRoot) {
  return path.join(sessionDir(projectRoot), HANDLE_NAME);
}

// The per-workspace salt for the daemon's argv marker (#236). Read and created
// by session-salt.js; this module stays free of IO.
function saltPath(projectRoot) {
  return path.join(sessionDir(projectRoot), SALT_NAME);
}

// Exclusive workspace lock acquired BEFORE building the mobile-mcp connection so
// a double-spawn loser fails fast and exits before it ever spawns a child.
function lockPath(projectRoot) {
  return path.join(sessionDir(projectRoot), LOCK_NAME);
}

// The workspace a daemon serves, as it appears on its command line (#156).
// The daemon itself reads its root from env (MAUTO_SESSION_PROJECT_ROOT), which
// `ps` cannot see, so every daemon's command line used to be identical. This
// marker is what lets `session end` tell THIS workspace's daemon from another
// workspace's before it signals a process group: a copied workspace (`cp -R`
// carries daemon.pid) or a recycled pid can name a different live daemon.
//
// The marker is a SALTED key, not the path (#236). `ps` shows every process's
// argv to every user on the host, and a project path can name a client or an
// unreleased project. An unsalted digest would not hide it: another user can
// guess `/Users/alice/clients/acme-app`, hash it, and compare. So the key is
// HMAC-SHA256(salt, resolved root), where the salt is a per-workspace secret in
// .session/marker.salt (mode 0600, session-salt.js). Both inputs are needed:
//   - the salt makes the key unconfirmable by anyone who cannot read the
//     workspace;
//   - the root keeps `cp -R` safe: a copied workspace carries the salt AND
//     daemon.pid, but its root differs, so the original daemon's key never
//     names the copy.
// Losing the salt strands nothing new: it lives beside daemon.pid, so whatever
// removes one removes the other. The daemon never reads its argv. The key is
// the LAST argument so a match can be anchored at the end.
const DAEMON_WORKSPACE_FLAG = '--workspace-key';

// Match-only, never emitted. Daemons started by 0.28.0-0.35.0 carry the
// absolute root behind this flag; still recognising them keeps a stuck one
// force-stoppable by `session end` after an upgrade.
const LEGACY_DAEMON_ROOT_FLAG = '--project-root';

function daemonMarkerKey(projectRoot, salt) {
  return crypto.createHmac('sha256', String(salt)).update(path.resolve(projectRoot)).digest('hex').slice(0, 16);
}

function daemonArgv(projectRoot, salt) {
  return [DAEMON_WORKSPACE_FLAG, daemonMarkerKey(projectRoot, salt)];
}

// Does a `ps -o command=` line name exactly this workspace, by salted key or by
// the legacy root? The key form needs the workspace's salt: with none (missing
// or unreadable) no keyed daemon can be proven ours. The legacy form needs no
// salt. Anchored at the end of the line so `/a/proj` never matches a daemon
// serving `/a/proj2`, and a key never matches a longer or shorter one.
function commandNamesWorkspace(command, projectRoot, salt = null) {
  const line = String(command || '').replace(/\s+$/, '');
  if (salt != null && line.endsWith(` ${DAEMON_WORKSPACE_FLAG} ${daemonMarkerKey(projectRoot, salt)}`)) return true;
  return line.endsWith(` ${LEGACY_DAEMON_ROOT_FLAG} ${path.resolve(projectRoot)}`);
}

// Does a `ps -o command=` line carry a workspace marker of EITHER kind, whatever
// workspace it names (#237)? Daemons started by mauto <= 0.27.x carry none, and
// "names no workspace" is a different fact from "names another workspace": the
// first cannot be told apart by its command line at all, so `session end`
// falls back to the socket and the lock; the second is proof it is not ours.
// Matched as a whole argv token (whitespace or line edge on both sides), so a
// path that merely contains the flag's text is not a marker.
const MARKER_FLAG_TOKEN = new RegExp(`(?:^|\\s)(?:${DAEMON_WORKSPACE_FLAG}|${LEGACY_DAEMON_ROOT_FLAG})(?=\\s|$)`);

function commandHasWorkspaceMarker(command) {
  return MARKER_FLAG_TOKEN.test(String(command || ''));
}

// A path as it should appear in a child's argv (or an env var the child execs
// by) (#236). `ps` shows every process's argv to every user on the host, and
// when mobile-automator is installed inside the project (a devDependency, a
// source checkout) the absolute paths of the daemon bin, the engine entry and
// mobilecli all contain the project root, which often names a client. A file
// under the root is returned relative to it; the caller MUST run the child with
// cwd = projectRoot, or the relative path resolves somewhere else. A file
// outside the root (a global install) is returned unchanged: it reveals no
// project path.
//
// Both sides are compared by realpath, so a root reached through a symlink
// (macOS /tmp vs /private/tmp, a symlinked checkout) still gets the relative
// form, and the result is relative to the REAL root, which is what the child's
// cwd resolves to. A path that cannot be realpath'd (it does not exist yet, or
// in unit tests) falls back to path.resolve. "Under" is strict: the root itself
// is not under it, and a sibling sharing its prefix (/a/proj2 vs /a/proj) is
// outside it.
function realOrResolved(p) {
  try {
    return fs.realpathSync(p);
  } catch (_e) {
    return path.resolve(p);
  }
}

function argvPath(projectRoot, absPath) {
  const rel = path.relative(realOrResolved(projectRoot), realOrResolved(absPath));
  if (!rel || path.isAbsolute(rel) || rel === '..' || rel.startsWith('..' + path.sep)) return absPath;
  return rel;
}

module.exports = {
  SESSION_DIRNAME,
  SOCKET_NAME,
  PID_NAME,
  HANDLE_NAME,
  LOCK_NAME,
  LOG_NAME,
  SALT_NAME,
  SOCKET_PATH_LIMIT,
  sessionDir,
  workspaceSocketPath,
  socketPath,
  logFilePath,
  pidFilePath,
  handlePath,
  lockPath,
  saltPath,
  workspaceKey,
  daemonMarkerKey,
  DAEMON_WORKSPACE_FLAG,
  LEGACY_DAEMON_ROOT_FLAG,
  daemonArgv,
  commandNamesWorkspace,
  commandHasWorkspaceMarker,
  argvPath,
};
