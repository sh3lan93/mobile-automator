'use strict';

// Workspace config manager for the `mauto` CLI.
//
// Reads/writes mobile-automator/config.json under a project root. Mode
// resolution mirrors the recorder's prior art (tools/recorder/src/config.js):
// a config without an explicit `mode` is treated as `platform-aware`.

const fs = require('fs');
const path = require('path');

function configDir(projectRoot) {
  return path.join(projectRoot, 'mobile-automator');
}

function configPath(projectRoot) {
  return path.join(configDir(projectRoot), 'config.json');
}

// Parsed config object, or null when the file is absent.
function load(projectRoot) {
  const p = configPath(projectRoot);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Default to platform-aware for null/empty/legacy configs.
function resolveMode(cfg) {
  return cfg && cfg.mode ? cfg.mode : 'platform-aware';
}

// Dotted-path lookup. Missing path -> undefined.
function get(projectRoot, key) {
  const cfg = load(projectRoot);
  if (cfg == null) return undefined;
  return getPath(cfg, key);
}

// Load-or-{}, set the dotted path, write back preserving every other field as
// pretty 2-space JSON. Creates mobile-automator/ if needed.
function set(projectRoot, key, value) {
  const cfg = load(projectRoot) || {};
  setPath(cfg, key, value);
  fs.mkdirSync(configDir(projectRoot), { recursive: true });
  fs.writeFileSync(configPath(projectRoot), JSON.stringify(cfg, null, 2) + '\n');
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

module.exports = { load, resolveMode, get, set, configPath, configDir };
