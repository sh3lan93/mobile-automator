#!/usr/bin/env node
'use strict';

// Detached entrypoint for the device session daemon. session-spawn.js launches
// this with the project root / device / idle timeout passed via env vars.
//
// Kept dependency-light and side-effect-free at require time so the unit smoke
// test can load it without spawning a daemon: startDaemon only runs under
// `require.main === module`.

const { startDaemon } = require('../src/device/session-daemon');

async function main() {
  const projectRoot = process.env.MAUTO_SESSION_PROJECT_ROOT;
  if (!projectRoot) {
    process.stderr.write('mauto-session-daemon: MAUTO_SESSION_PROJECT_ROOT is required\n');
    process.exit(3);
  }
  const device = process.env.MAUTO_SESSION_DEVICE || null;
  const idleRaw = process.env.MAUTO_SESSION_IDLE_MS;
  const idleMs = idleRaw ? Number(idleRaw) : undefined;

  const daemon = await startDaemon({ projectRoot, device, idleMs });
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
