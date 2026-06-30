'use strict';

// Pure path helpers for the per-workspace device session daemon.
//
// Everything lives under <projectRoot>/mobile-automator/.session/:
//   mauto.sock    — Unix domain socket the daemon listens on
//   daemon.pid    — pidfile written once the daemon is listening
//   session.json  — handle describing the live session (device pin, socket, pid)
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
  const hash = crypto
    .createHash('sha1')
    .update(path.resolve(projectRoot))
    .digest('hex')
    .slice(0, 16);
  return path.join(os.tmpdir(), `mauto-${hash}.sock`);
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

module.exports = {
  SESSION_DIRNAME,
  SOCKET_NAME,
  PID_NAME,
  HANDLE_NAME,
  LOCK_NAME,
  SOCKET_PATH_LIMIT,
  sessionDir,
  workspaceSocketPath,
  socketPath,
  pidFilePath,
  handlePath,
  lockPath,
};
