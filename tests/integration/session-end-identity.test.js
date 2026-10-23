'use strict';

// #156 regression: `session end` group-kills a pidfile's process only when that
// process's command line names THIS workspace. A copied workspace (`cp -R`
// carries daemon.pid) or a recycled pid used to reach another workspace's live
// daemon, because every daemon's command line was identical.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const { endSession } = require('../../src/device/session-end');
const { pidAlive } = require('../../src/device/process-identity');
const { waitForDeath } = require('../../src/device/process-reaper');
const paths = require('../../src/device/session-paths');

jest.setTimeout(15000);

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-end-id-'));
  fs.mkdirSync(paths.sessionDir(root), { recursive: true });
  return root;
}

// A stand-in daemon with the real command-line shape — a script named
// mauto-session-daemon.js followed by the workspace marker — detached like the
// real one, so it leads its own process group. It never listens, so it can
// never acknowledge a shutdown: the path that escalates. `argv` defaults to the
// marker the real spawn emits; a test passes the legacy one to stand in for a
// daemon started by an older mauto.
function standIn(servesRoot, argv = paths.daemonArgv(servesRoot)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-standin-'));
  const bin = path.join(dir, 'mauto-session-daemon.js');
  fs.writeFileSync(bin, "process.on('SIGTERM', () => process.exit(0));\nsetInterval(() => {}, 1000);\n");
  const child = spawn(process.execPath, [bin, ...argv], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return child;
}

function killGroup(pid) {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (_) {
    /* already gone */
  }
}

test("a pidfile naming another workspace's live daemon is never signalled", async () => {
  const mine = workspace();
  const theirs = workspace();
  const daemon = standIn(theirs);
  try {
    // e.g. `cp -R theirs mine` while their daemon ran: the pidfile came along.
    fs.writeFileSync(paths.pidFilePath(mine), `${daemon.pid}\n`);
    expect(await endSession(mine)).toEqual({ outcome: 'already_stopped', pid: daemon.pid });
    expect(pidAlive(daemon.pid)).toBe(true);
  } finally {
    killGroup(daemon.pid);
  }
});

test("this workspace's own unresponsive daemon is still escalated", async () => {
  const mine = workspace();
  const daemon = standIn(mine);
  try {
    fs.writeFileSync(paths.pidFilePath(mine), `${daemon.pid}\n`);
    expect(await endSession(mine)).toEqual({ outcome: 'forced', pid: daemon.pid });
    expect(await waitForDeath(daemon.pid, { budgetMs: 2000 })).toBe(true);
  } finally {
    killGroup(daemon.pid);
  }
});

// #236: daemons started by 0.28.0-0.33.x carry `--project-root <root>`. After an
// upgrade, a stuck one must still be recognised as ours and force-stopped.
test("a legacy --project-root daemon for this workspace is still escalated (#236)", async () => {
  const mine = workspace();
  const daemon = standIn(mine, [paths.LEGACY_DAEMON_ROOT_FLAG, path.resolve(mine)]);
  try {
    fs.writeFileSync(paths.pidFilePath(mine), `${daemon.pid}\n`);
    expect(await endSession(mine)).toEqual({ outcome: 'forced', pid: daemon.pid });
    expect(await waitForDeath(daemon.pid, { budgetMs: 2000 })).toBe(true);
  } finally {
    killGroup(daemon.pid);
  }
});

// #236: `ps` shows argv to every user on the host, so the marker must not
// carry the workspace path.
test("the daemon's command line does not reveal the workspace path (#236)", () => {
  const mine = workspace();
  const daemon = standIn(mine);
  try {
    const line = execFileSync('ps', ['-ww', '-p', String(daemon.pid), '-o', 'command='], { encoding: 'utf8' });
    expect(line).toMatch(/mauto-session-daemon/);
    expect(line).not.toContain(mine);
    expect(line).not.toContain(path.basename(mine));
    expect(paths.commandNamesWorkspace(line, mine)).toBe(true);
  } finally {
    killGroup(daemon.pid);
  }
});
