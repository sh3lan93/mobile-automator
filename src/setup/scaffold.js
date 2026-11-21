'use strict';

// Workspace scaffolding for `mauto setup`.
//
// Creates the .mobile-automator/{scenarios,screenshots,results} tree and a
// skeleton config.json. Idempotent: re-running never clobbers an existing
// config's other fields, and changes its `mode` only when one is requested
// explicitly (#333) — DEFAULT_MODE is for a new workspace, never a reset.

const fs = require('fs');
const path = require('path');

const manager = require('../config/manager');
const { workspaceDir } = require('../workspace/layout');
const { atomicWrite } = require('../util/atomic');

const SUBDIRS = ['scenarios', 'screenshots', 'results', 'memory'];

// Runtime artifacts that must never reach a user's git history. `.session/`
// holds a socket, pidfile, handle and (since #163) daemon.log, which carries
// device serials, adb/simctl output and stack traces. `.logs/` holds the
// structured event stream. Neither is reproducible input.
//
// `screenshots/` mixes run actuals and diffs (runtime output) with reference
// baselines under `screenshots/reference/`, which `screenshot_match` reads and
// the user commits (#328). The rule must be `screenshots/*`, not
// `screenshots/`: git cannot re-include a path whose parent directory is
// excluded, so `!screenshots/reference/` only works when the directory itself
// is left un-ignored and its children are ignored instead.
//
// Every body `mauto setup` has shipped, oldest first. The last entry is what
// setup writes; a file byte-identical to an earlier entry was never edited and
// is upgraded to the last. To change the body, APPEND a new entry. Never edit
// or remove a shipped one; tests/unit/setup/scaffold.test.js pins them.
const GITIGNORE_BODIES = [
  // 0.25.0 → 0.40.2 (b684f38): ignored all of screenshots/, baselines included.
  [
    '# Managed by `mauto setup`. Runtime artifacts — not source.',
    '.session/',
    '.logs/',
    'screenshots/',
    '',
  ].join('\n'),
  // 0.40.3 (#328): reference baselines tracked.
  [
    '# Managed by `mauto setup`. Runtime artifacts are ignored; reference screenshots are kept.',
    '.session/',
    '.logs/',
    '# `screenshots/*`, not `screenshots/`, so the `reference/` exception below can apply.',
    'screenshots/*',
    '!screenshots/reference/',
    '',
  ].join('\n'),
];
const CURRENT_GITIGNORE_BODY = GITIGNORE_BODIES[GITIGNORE_BODIES.length - 1];

// `mode` is optional: undefined means "the caller did not choose one". Returns
// the workspace's effective mode and `modeChanged` ({from, to} when an explicit
// mode changed an existing workspace's effective mode, else null).
function scaffold(projectRoot, { mode } = {}) {
  const created = [];
  const upgraded = [];

  const baseDir = workspaceDir(projectRoot);
  ensureDir(baseDir, created);
  for (const sub of SUBDIRS) {
    ensureDir(path.join(baseDir, sub), created);
  }

  const gitignorePath = path.join(baseDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    atomicWrite(gitignorePath, CURRENT_GITIGNORE_BODY);
    created.push(gitignorePath);
  } else if (GITIGNORE_BODIES.slice(0, -1).includes(fs.readFileSync(gitignorePath, 'utf8'))) {
    atomicWrite(gitignorePath, CURRENT_GITIGNORE_BODY);
    upgraded.push(gitignorePath);
  }

  const cfgPath = manager.configPath(projectRoot);
  if (fs.existsSync(cfgPath)) {
    return { created, upgraded, configWritten: false, ...applyMode(projectRoot, mode) };
  }
  // Fresh skeleton — single source of truth for the day-one config shape.
  const skeleton = {
    mode: mode || manager.DEFAULT_MODE,
    project_name: null,
    environments: [],
    default_environment: null,
    // Written as a LITERAL false rather than omitted. An absent key that
    // happens to default off is not discoverable; a visible false is, and
    // discoverability is part of consent. applyMode never touches this key:
    // re-running setup must not silently revoke — or silently grant — a choice
    // the project owner already made.
    telemetry: { enabled: false },
  };
  fs.writeFileSync(cfgPath, JSON.stringify(skeleton, null, 2) + '\n');
  created.push(cfgPath);
  return { created, upgraded, configWritten: true, mode: skeleton.mode, modeChanged: null };
}

// An existing config keeps its mode unless one is requested (#333); an
// explicit mode is written (every other field preserved) and reported as a
// change only when it moves the effective mode (resolveMode), so a config
// predating the field gains `mode` without a reported change.
function applyMode(projectRoot, mode) {
  const current = manager.resolveMode(manager.load(projectRoot));
  if (!mode) return { mode: current, modeChanged: null };
  manager.set(projectRoot, 'mode', mode);
  return { mode, modeChanged: current === mode ? null : { from: current, to: mode } };
}

function ensureDir(dir, created) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    created.push(dir);
  }
}

module.exports = { scaffold, GITIGNORE_BODIES };
