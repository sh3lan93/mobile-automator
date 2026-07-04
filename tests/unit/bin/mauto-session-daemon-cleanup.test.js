'use strict';

// Regression guard for the spawn-race cleanup (#130 review, finding 1):
// the exit-time workspace teardown must be OWNERSHIP-GATED. A loser of the
// double-spawn race (its startDaemon threw ELOCKED) never acquired the lock,
// so on its process 'exit' it must NOT delete the WINNER's lock/socket/pid/
// handle — doing so would free the lock and unlink the live socket path,
// letting a second mobile-mcp child spawn (the exact C2/B2 orphan this lock
// exists to prevent). The bin exercises process.on('exit'), which the
// in-process startDaemon tests never touch — hence this direct test.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { cleanupWorkspaceIfOwned } = require('../../../bin/mauto-session-daemon');
const paths = require('../../../src/device/session-paths');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-daemon-cleanup-'));
}

const workspaceFiles = (root) => [
  paths.lockPath(root),
  paths.socketPath(root),
  paths.pidFilePath(root),
  paths.handlePath(root),
];

// Seed a workspace whose LOCK file names `lockPid` as the owner.
function seedWorkspace(root, lockPid) {
  for (const f of workspaceFiles(root)) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, `${lockPid}\n`);
  }
}

const allExist = (root) => workspaceFiles(root).every((f) => fs.existsSync(f));
const noneExist = (root) => workspaceFiles(root).every((f) => !fs.existsSync(f));

describe('daemon bin: ownership-gated workspace cleanup', () => {
  test('a spawn-race LOSER (lock owned by another pid) leaves the winner files intact', () => {
    const root = tmpRoot();
    seedWorkspace(root, process.pid + 1); // someone else owns the lock
    cleanupWorkspaceIfOwned(root); // as if the loser process is exiting
    expect(allExist(root)).toBe(true);
  });

  test('the OWNER (lock holds our pid) tears its workspace down', () => {
    const root = tmpRoot();
    seedWorkspace(root, process.pid);
    cleanupWorkspaceIfOwned(root);
    expect(noneExist(root)).toBe(true);
  });

  test('no lock present -> a no-op that never throws', () => {
    const root = tmpRoot();
    expect(() => cleanupWorkspaceIfOwned(root)).not.toThrow();
  });
});
