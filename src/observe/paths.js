'use strict';

// Pure path helpers for the structured event logs. Side-effect-free so they
// can be unit-tested without touching the filesystem, matching
// src/device/session-paths.js.
//
// NOTE: this is NOT where the daemon's raw stdio goes. That lives at
// mobile-automator/.session/daemon.log (session-paths.logFilePath, PR #176).
// Two artifacts, two homes: raw process output there, structured events here.

const path = require('path');

const LOGS_DIRNAME = '.logs';
const MAIN_LOG_NAME = 'mauto.ndjson';

// The workspace root `mauto setup` creates. The file sink treats its existence
// as permission to log: mauto runs from whatever directory a user is standing
// in, so creating this tree as a side effect of logging would litter unrelated
// repos with a directory that has no .gitignore in it.
function workspaceDir(projectRoot) {
  return path.join(projectRoot, 'mobile-automator');
}

function logsDir(projectRoot, env = process.env) {
  if (env && env.MAUTO_LOG_DIR) return path.resolve(env.MAUTO_LOG_DIR);
  return path.join(projectRoot, 'mobile-automator', LOGS_DIRNAME);
}

function mainLogPath(projectRoot, env = process.env) {
  return path.join(logsDir(projectRoot, env), MAIN_LOG_NAME);
}

module.exports = { LOGS_DIRNAME, MAIN_LOG_NAME, workspaceDir, logsDir, mainLogPath };
