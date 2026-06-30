#!/usr/bin/env node
'use strict';

// Detached entrypoint for the device session daemon. session-spawn.js launches
// this with the project root / device / idle timeout passed via env vars.
//
// Kept dependency-light and side-effect-free at require time so the unit smoke
// test can load it without spawning a daemon: startDaemon only runs under
// `require.main === module`.

const fs = require('fs');

const { startDaemon } = require('../src/device/session-daemon');
const paths = require('../src/device/session-paths');

// Best-effort synchronous unlink — never throws. Used by the crash guards so a
// hard failure can't leave a stale lock/socket/pidfile wedging the next spawn.
function safeUnlinkSync(p) {
  try {
    fs.unlinkSync(p);
  } catch (_) {
    /* not present */
  }
}

async function main() {
  const projectRoot = process.env.MAUTO_SESSION_PROJECT_ROOT;
  if (!projectRoot) {
    process.stderr.write('mauto-session-daemon: MAUTO_SESSION_PROJECT_ROOT is required\n');
    process.exit(3);
  }
  const device = process.env.MAUTO_SESSION_DEVICE || null;
  const idleRaw = process.env.MAUTO_SESSION_IDLE_MS;
  const idleMs = idleRaw ? Number(idleRaw) : undefined;

  let daemon = null;

  // Crash guards: this is the real, single-daemon process, so a best-effort
  // teardown on a crash keeps a leaked mobile-mcp child / stale files from
  // wedging the next spawn. (Kept OUT of startDaemon so in-process tests that
  // start many daemons don't accumulate global listeners.)
  const onExit = () => {
    // 'exit' allows only synchronous work — drop the lock + socket + pidfile so
    // the next spawn isn't wedged by leftovers from this process.
    safeUnlinkSync(paths.lockPath(projectRoot));
    safeUnlinkSync(paths.socketPath(projectRoot));
    safeUnlinkSync(paths.pidFilePath(projectRoot));
    safeUnlinkSync(paths.handlePath(projectRoot));
  };
  process.on('exit', onExit);
  process.on('uncaughtException', (err) => {
    process.stderr.write(`mauto-session-daemon: uncaught ${err && err.stack ? err.stack : err}\n`);
    // Tear the daemon down (closes the mobile-mcp child) then let 'exit' clean
    // the files.
    if (daemon && typeof daemon.stop === 'function') {
      daemon.stop().catch(() => {});
    }
    process.exit(1);
  });

  daemon = await startDaemon({ projectRoot, device, idleMs });
  // Keep the event loop alive until the daemon stops (idle reap / signal /
  // shutdown frame), then exit cleanly.
  await daemon.whenStopped;
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`mauto-session-daemon: ${err.message || err}\n`);
    process.exit(1);
  });
}

module.exports = { main };
