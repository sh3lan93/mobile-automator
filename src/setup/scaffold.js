'use strict';

// Workspace scaffolding for `mauto setup`.
//
// Creates the mobile-automator/{scenarios,screenshots,results} tree and a
// skeleton config.json. Idempotent: re-running never clobbers an existing
// config's other fields — it only ensures the requested `mode` is set.

const fs = require('fs');
const path = require('path');

const manager = require('../config/manager');

const SUBDIRS = ['scenarios', 'screenshots', 'results', 'memory'];

// Runtime artifacts that must never reach a user's git history. `.session/`
// has held a socket, pidfile and handle since the CLI landed; since #163 it
// also holds daemon.log, which carries device serials, adb/simctl output and
// stack traces. `.logs/` holds the structured event stream. Neither is
// reproducible input and both are noise in a diff.
//
// Written only when absent: a user who edits this file owns it thereafter.
const GITIGNORE_BODY = [
  '# Managed by `mauto setup`. Runtime artifacts — not source.',
  '.session/',
  '.logs/',
  'screenshots/',
  '',
].join('\n');

function scaffold(projectRoot, { mode } = {}) {
  const created = [];

  const baseDir = path.join(projectRoot, 'mobile-automator');
  ensureDir(baseDir, created);
  for (const sub of SUBDIRS) {
    ensureDir(path.join(baseDir, sub), created);
  }

  const gitignorePath = path.join(baseDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, GITIGNORE_BODY);
    created.push(gitignorePath);
  }

  const cfgPath = manager.configPath(projectRoot);
  let configWritten = false;
  if (!fs.existsSync(cfgPath)) {
    // Fresh skeleton — single source of truth for the day-one config shape.
    const skeleton = {
      mode,
      project_name: null,
      environments: [],
      default_environment: null,
    };
    fs.writeFileSync(cfgPath, JSON.stringify(skeleton, null, 2) + '\n');
    created.push(cfgPath);
    configWritten = true;
  } else {
    // Pre-existing config: only set the mode, preserving every other field.
    manager.set(projectRoot, 'mode', mode);
  }

  return { created, mode, configWritten };
}

function ensureDir(dir, created) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    created.push(dir);
  }
}

module.exports = { scaffold };
