'use strict';

// Persisted device selection for the `mauto` CLI.
//
// A chosen device id is remembered across separate one-shot verb invocations so
// the agent does not have to re-pass --device every call. The selection lives in
// #91's session layout (.mobile-automator/.session/) as a small sidecar file,
// SEPARATE from config.json (which is user-authored project config) and from the
// live session handle (session.json, owned by the daemon lifecycle).
//
// `read` is graceful: a missing OR corrupt file returns null so a verb never
// crashes on a half-written/garbage selection — it just behaves as "no
// selection". The directory is created lazily on write. Every access goes
// through safe-fs (#345): a symlinked .session/ or selection.json throws
// UnsafePathError, so the verb fails environment instead of following it.

const fs = require('fs');
const path = require('path');

const paths = require('./session-paths');
const { atomicWrite } = require('../util/atomic');
const { UnsafePathError, readWorkspaceFile, safeDir } = require('../workspace/safe-fs');

const SELECTION_NAME = 'selection.json';

function selectionPath(projectRoot) {
  return path.join(paths.sessionDir(projectRoot), SELECTION_NAME);
}

// The persisted device id, or null when absent/corrupt.
function read(projectRoot) {
  try {
    const raw = readWorkspaceFile(projectRoot, selectionPath(projectRoot));
    if (raw == null) return null;
    const parsed = JSON.parse(raw);
    const id = parsed && parsed.device;
    return id ? String(id) : null;
  } catch (err) {
    if (err instanceof UnsafePathError) throw err;
    return null;
  }
}

// Persist a device id. Creates .mobile-automator/.session/ if needed. Written
// via atomicWrite (tmp + fsync + rename) so a concurrent reader or a crash
// sees the old-complete or new-complete selection, never a torn one.
function write(projectRoot, id) {
  atomicWrite(
    selectionPath(projectRoot),
    JSON.stringify({ device: String(id) }, null, 2) + '\n',
    { projectRoot }
  );
  return String(id);
}

// Remove the persisted selection. Idempotent — clearing when none exists is a
// no-op. The .session/ walk comes first: unlinking through a symlinked
// .session/ would delete a file outside the workspace, so that throws
// UnsafePathError instead. unlink removes a link leaf itself, never its target.
function clear(projectRoot) {
  try {
    safeDir(projectRoot, paths.sessionDir(projectRoot));
  } catch (err) {
    if (err.code === 'ENOENT') return; // no .session/, so no selection
    throw err;
  }
  try {
    fs.unlinkSync(selectionPath(projectRoot));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

// Pure precedence resolver: an explicit --device flag ALWAYS wins and is never
// written to the store (it is a per-call override only); otherwise fall back to
// the persisted selection; otherwise none. `store` is injectable so this stays
// pure and unit-testable without touching the filesystem.
//
// Returns { device, source } where source is:
//   'flag'    — explicit --device supplied
//   'session' — resolved from the persisted selection
//   'none'    — no device chosen (mobile-mcp will auto-select a single device)
function resolveDevice({ explicit, projectRoot, store = module.exports } = {}) {
  if (explicit) {
    return { device: String(explicit), source: 'flag' };
  }
  const persisted = store.read(projectRoot);
  if (persisted) {
    return { device: persisted, source: 'session' };
  }
  return { device: null, source: 'none' };
}

module.exports = { selectionPath, read, write, clear, resolveDevice, SELECTION_NAME };
