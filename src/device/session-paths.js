'use strict';

// Pure path helpers for the per-workspace device session daemon.
//
// Everything lives under <projectRoot>/mobile-automator/.session/:
//   mauto.sock    — Unix domain socket the daemon listens on
//   daemon.pid    — pidfile written once the daemon is listening
//   session.json  — handle describing the live session (device pin, socket, pid)
//   daemon.log    — bounded stdout/stderr capture from the detached daemon
//
// These are intentionally side-effect-free so they can be unit-tested without
// touching the filesystem.

const path = require('path');
const os = require('os');
const crypto = require('crypto');

const SESSION_DIRNAME = '.session';
const SOCKET_NAME = 'mauto.sock';
const PID_NAME = 'daemon.pid';
const HANDLE_NAME = 'session.json';
const LOCK_NAME = 'daemon.lock';
const LOG_NAME = 'daemon.log';

// Unix domain socket paths have a hard length limit (~104 bytes on macOS,
// ~108 on Linux). Deep project roots blow past it, so when the in-workspace
// path would be too long we fall back to a short, deterministic socket path in
// the OS temp dir keyed by a hash of the project root. pidfile + handle always
// stay in the workspace (per-workspace ownership), and the handle records the
// actual socket path it bound.
const SOCKET_PATH_LIMIT = 100;

function sessionDir(projectRoot) {
  return path.join(projectRoot, 'mobile-automator', SESSION_DIRNAME);
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

// A short, opaque, deterministic name for a workspace: the first 16 hex chars
// of sha1(resolved project root). It names the tmpdir socket fallback above and
// the daemon's argv marker below. Changing it moves the socket a running daemon
// is bound to, so its output is pinned by tests.
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
// The marker is the workspace's digest, not its path (#236). `ps` shows every
// process's argv to every user on the host, and a project path can name a
// client or an unreleased project. The daemon never reads its argv, so an
// opaque key identifies the workspace just as well. It exposes nothing new:
// the same digest already names the tmpdir socket fallback (socketPath).
// The key is the LAST argument so a match can be anchored at the end.
const DAEMON_WORKSPACE_FLAG = '--workspace-key';

// Match-only, never emitted. Daemons started by 0.28.0-0.33.x carry the
// absolute root behind this flag; still recognising them keeps a stuck one
// force-stoppable by `session end` after an upgrade.
const LEGACY_DAEMON_ROOT_FLAG = '--project-root';

function daemonArgv(projectRoot) {
  return [DAEMON_WORKSPACE_FLAG, workspaceKey(projectRoot)];
}

// Does a `ps -o command=` line name exactly this workspace, by key or by the
// legacy root? Anchored at the end of the line so `/a/proj` never matches a
// daemon serving `/a/proj2`, and a key never matches a longer or shorter one.
function commandNamesWorkspace(command, projectRoot) {
  const line = String(command || '').replace(/\s+$/, '');
  return (
    line.endsWith(` ${DAEMON_WORKSPACE_FLAG} ${workspaceKey(projectRoot)}`) ||
    line.endsWith(` ${LEGACY_DAEMON_ROOT_FLAG} ${path.resolve(projectRoot)}`)
  );
}

module.exports = {
  SESSION_DIRNAME,
  SOCKET_NAME,
  PID_NAME,
  HANDLE_NAME,
  LOCK_NAME,
  LOG_NAME,
  SOCKET_PATH_LIMIT,
  sessionDir,
  workspaceSocketPath,
  socketPath,
  logFilePath,
  pidFilePath,
  handlePath,
  lockPath,
  workspaceKey,
  DAEMON_WORKSPACE_FLAG,
  LEGACY_DAEMON_ROOT_FLAG,
  daemonArgv,
  commandNamesWorkspace,
};
