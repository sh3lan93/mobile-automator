'use strict';

// Workspace scaffolding for `mauto setup`.
//
// Creates the .mobile-automator/{scenarios,screenshots,results} tree and a
// skeleton config.json. Idempotent: re-running never clobbers an existing
// config's other fields — it only ensures the requested `mode` is set.

const fs = require('fs');
const path = require('path');

const manager = require('../config/manager');
const { workspaceDir } = require('../workspace/layout');
const { atomicWrite } = require('../util/atomic');

const SUBDIRS = ['scenarios', 'screenshots', 'results', 'memory'];

// Runtime artifacts that must never reach a user's git history. `.session/`
// has held a socket, pidfile and handle since the CLI landed; since #163 it
// also holds daemon.log, which carries device serials, adb/simctl output and
// stack traces. `.logs/` holds the structured event stream. Neither is
// reproducible input and both are noise in a diff.
//
// `screenshots/` mixes two kinds of file. Run actuals and diffs
// (`screenshots/<scenario>/<run_id>/`, `screenshots/assert/…`) are runtime
// output; reference baselines (`screenshots/reference/<scenario>/<assertion>.png`,
// read by `screenshot_match`) are source the user commits (#328). The rule must
// be `screenshots/*`, not `screenshots/`: git cannot re-include a path whose
// parent directory is excluded, so `!screenshots/reference/` only works when
// the directory itself is left un-ignored and its children are ignored instead.
//
// Written when absent. Upgraded in place only when it is byte-identical to a
// body an earlier mauto shipped (LEGACY_GITIGNORE_BODIES), so it was never
// edited. Left alone otherwise: a user who edits this file owns it.
const GITIGNORE_BODY = [
  '# Managed by `mauto setup`. Runtime artifacts — not source.',
  '.session/',
  '.logs/',
  '# `screenshots/*`, not `screenshots/`: git cannot re-include a path whose',
  '# parent directory is excluded. Reference baselines are source — commit them.',
  'screenshots/*',
  '!screenshots/reference/',
  '',
].join('\n');

// Every body a previous mauto setup wrote, verbatim. A file equal to one of
// these was never edited, so upgrading it takes nothing from the user.
const LEGACY_GITIGNORE_BODIES = [
  // b684f38 → 0.40.2: ignored all of screenshots/, reference baselines included.
  [
    '# Managed by `mauto setup`. Runtime artifacts — not source.',
    '.session/',
    '.logs/',
    'screenshots/',
    '',
  ].join('\n'),
];

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
    atomicWrite(gitignorePath, GITIGNORE_BODY);
    created.push(gitignorePath);
  } else if (LEGACY_GITIGNORE_BODIES.includes(fs.readFileSync(gitignorePath, 'utf8'))) {
    atomicWrite(gitignorePath, GITIGNORE_BODY);
    upgraded.push(gitignorePath);
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
      // Written as a LITERAL false rather than omitted. An absent key that
      // happens to default off is not discoverable; a visible false is, and
      // discoverability is part of consent. The `else` branch below never
      // touches this key: re-running setup must not silently revoke — or
      // silently grant — a choice the project owner already made.
      telemetry: { enabled: false },
    };
    fs.writeFileSync(cfgPath, JSON.stringify(skeleton, null, 2) + '\n');
    created.push(cfgPath);
    configWritten = true;
  } else {
    // Pre-existing config: only set the mode, preserving every other field.
    manager.set(projectRoot, 'mode', mode);
  }

  return { created, upgraded, mode, configWritten };
}

function ensureDir(dir, created) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    created.push(dir);
  }
}

module.exports = { scaffold };
