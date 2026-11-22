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
const { ensureSalt, readSalt } = require('../../../src/device/session-salt');
const { ensureSessionDirs } = require('../../../src/device/session-dir');
const { usePrivateTmpdir } = require('../../helpers/private-tmpdir');

// A deep temp root's socket goes to the fallback directory: keep it in a
// temp dir of this file's, never the real per-user one (#346).
usePrivateTmpdir();

const roots = [];
function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-daemon-cleanup-'));
  roots.push(root);
  return root;
}

// A deep tmpdir (macOS) puts the socket in the per-user fallback directory,
// outside the root: remove it too, so seeded files do not pile up there.
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(paths.socketPath(root), { force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const workspaceFiles = (root) => [
  paths.lockPath(root),
  paths.socketPath(root),
  paths.pidFilePath(root),
  paths.handlePath(root),
];

// Seed a workspace whose LOCK file names `lockPid` as the owner. The
// directories are made as the daemon makes them: the socket's may be the
// per-user fallback, which must stay 0700.
function seedWorkspace(root, lockPid) {
  ensureSessionDirs(root);
  for (const f of workspaceFiles(root)) {
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

  test("the OWNER's teardown spares the marker salt (#236)", () => {
    const root = tmpRoot();
    seedWorkspace(root, process.pid);
    const salt = ensureSalt(root);
    cleanupWorkspaceIfOwned(root);
    expect(noneExist(root)).toBe(true);
    expect(readSalt(root)).toBe(salt);
  });

  test('no lock present -> a no-op that never throws', () => {
    const root = tmpRoot();
    expect(() => cleanupWorkspaceIfOwned(root)).not.toThrow();
  });

  // #346: the lock is read without following links. A planted link to a file
  // holding our pid would otherwise pass for our own lock, and the exit
  // teardown would delete the live session's files.
  test('a lock that is a symlink to a file holding our pid is not ours', () => {
    const root = tmpRoot();
    seedWorkspace(root, process.pid + 1);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-daemon-cleanup-out-'));
    const target = path.join(outside, 'lock-target');
    fs.writeFileSync(target, `${process.pid}\n`);
    fs.unlinkSync(paths.lockPath(root));
    fs.symlinkSync(target, paths.lockPath(root));

    cleanupWorkspaceIfOwned(root);

    expect(allExist(root)).toBe(true);
    expect(fs.lstatSync(paths.lockPath(root)).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe(`${process.pid}\n`);
  });
});
