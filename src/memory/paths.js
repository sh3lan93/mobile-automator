'use strict';

const path = require('path');

// Canonical on-disk names for the three memory files. Keys are the stable
// `--kind` identifiers used across verbs; values are the markdown filenames.
const FILES = {
  'run-history': 'run-history.md',
  'app-knowledge': 'app-knowledge.md',
  preferences: 'preferences.md',
};

function memoryDir(projectRoot) {
  return path.join(projectRoot, 'mobile-automator', 'memory');
}

function memoryFile(projectRoot, name) {
  return path.join(memoryDir(projectRoot), FILES[name] || name);
}

function sessionDir(projectRoot) {
  return path.join(projectRoot, 'mobile-automator', '.session');
}

// The advisory lock guarding read-modify-write of the shared memory files.
// Lives in .session/ (already gitignored) alongside the device-session state.
function lockPath(projectRoot) {
  return path.join(sessionDir(projectRoot), 'memory.lock');
}

module.exports = { memoryDir, memoryFile, sessionDir, lockPath, FILES };
