'use strict';

// Persisted device selection for the `mauto` CLI.
//
// A chosen device id is remembered across separate one-shot verb invocations so
// the agent does not have to re-pass --device every call. The selection lives in
// #91's session layout (mobile-automator/.session/) as a small sidecar file,
// SEPARATE from config.json (which is user-authored project config) and from the
// live session handle (session.json, owned by the daemon lifecycle).
//
// `read` is graceful: a missing OR corrupt file returns null so a verb never
// crashes on a half-written/garbage selection — it just behaves as "no
// selection". The directory is created lazily on write.

const fs = require('fs');
const path = require('path');

const paths = require('./session-paths');

const SELECTION_NAME = 'selection.json';

function selectionPath(projectRoot) {
  return path.join(paths.sessionDir(projectRoot), SELECTION_NAME);
}

// The persisted device id, or null when absent/corrupt.
function read(projectRoot) {
  try {
    const raw = fs.readFileSync(selectionPath(projectRoot), 'utf8');
    const parsed = JSON.parse(raw);
    const id = parsed && parsed.device;
    return id ? String(id) : null;
  } catch (_) {
    return null;
  }
}

// Persist a device id. Creates mobile-automator/.session/ if needed.
function write(projectRoot, id) {
  fs.mkdirSync(paths.sessionDir(projectRoot), { recursive: true });
  fs.writeFileSync(
    selectionPath(projectRoot),
    JSON.stringify({ device: String(id) }, null, 2) + '\n'
  );
  return String(id);
}

// Remove the persisted selection. Idempotent — clearing when none exists is a
// no-op (never throws).
function clear(projectRoot) {
  try {
    fs.rmSync(selectionPath(projectRoot), { force: true });
  } catch (_) {
    /* ignore */
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
