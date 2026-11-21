'use strict';

// Workspace config manager for the `mauto` CLI.
//
// Reads/writes .mobile-automator/config.json under a project root.
// A config without an explicit `mode` is treated as `platform-aware`.

const path = require('path');
const { normalizeConfig } = require('./coerce');
const { workspaceDir } = require('../workspace/layout');
const { readWorkspaceFile } = require('../workspace/safe-fs');
const { atomicWorkspaceWrite } = require('../util/atomic');

function configPath(projectRoot) {
  return path.join(workspaceDir(projectRoot), 'config.json');
}

// Parsed config object, or null when the file is absent. Values written before
// the config schema existed are healed on the way out (a comma-joined list key
// becomes a real array) — see #136. Since set() is load-mutate-write, the next
// write persists the healed shape. Read through safe-fs (#345): a config.json
// that is a symlink (or sits under one) throws UnsafePathError, never follows.
function load(projectRoot) {
  const raw = readWorkspaceFile(projectRoot, configPath(projectRoot));
  if (raw == null) return null;
  return normalizeConfig(JSON.parse(raw));
}

// The mode of a workspace that never chose one: what `mauto setup` writes into
// a NEW config when no --mode is given, and what a config predating the field
// is read as. One constant, so the two cannot disagree.
const DEFAULT_MODE = 'platform-aware';

// Default to platform-aware for null/empty/legacy configs.
function resolveMode(cfg) {
  return cfg && cfg.mode ? cfg.mode : DEFAULT_MODE;
}

// Dotted-path lookup. Missing path -> undefined.
function get(projectRoot, key) {
  const cfg = load(projectRoot);
  if (cfg == null) return undefined;
  return getPath(cfg, key);
}

// Load-or-{}, set the dotted path, write back preserving every other field as
// pretty 2-space JSON. Creates .mobile-automator/ if needed; the write is
// atomic and goes through safe-fs, so it never lands outside the workspace.
function set(projectRoot, key, value) {
  const cfg = load(projectRoot) || {};
  setPath(cfg, key, value);
  atomicWorkspaceWrite(projectRoot, configPath(projectRoot), JSON.stringify(cfg, null, 2) + '\n');
  return cfg;
}

function getPath(obj, key) {
  const parts = String(key).split('.');
  let cur = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

function setPath(obj, key, value) {
  const parts = String(key).split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (cur[part] == null || typeof cur[part] !== 'object') {
      cur[part] = {};
    }
    cur = cur[part];
  }
  cur[parts[parts.length - 1]] = value;
}

module.exports = { load, resolveMode, get, set, configPath, DEFAULT_MODE };
