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
const { cleanStale } = require('../../src/device/session-daemon');
const { pidAlive } = require('../../src/device/process-identity');
const { waitForDeath } = require('../../src/device/process-reaper');
const paths = require('../../src/device/session-paths');
const { ensureSalt, readSalt } = require('../../src/device/session-salt');

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
// marker the real spawn emits, keyed with the workspace's real salt (#236) so
// `session end` can recognise it; a test passes the legacy one to stand in for a
// daemon started by an older mauto.
function standIn(servesRoot, argv = paths.daemonArgv(servesRoot, ensureSalt(servesRoot))) {
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

// #236: the marker is HMAC(salt, root). A `cp -R` copies the salt AND
// daemon.pid, so the salt alone cannot tell the copy from the original; the
// root it is keyed over can. The original's daemon is never the copy's.
test("a cp -R'd workspace (salt and pidfile copied) never signals the original's daemon (#236)", async () => {
  const theirs = workspace();
  const daemon = standIn(theirs);
  const mine = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-end-copy-'));
  try {
    fs.writeFileSync(paths.pidFilePath(theirs), `${daemon.pid}\n`);
    fs.cpSync(path.join(theirs, 'mobile-automator'), path.join(mine, 'mobile-automator'), { recursive: true });
    expect(readSalt(mine)).toBe(readSalt(theirs));
    expect(await endSession(mine)).toEqual({ outcome: 'already_stopped', pid: daemon.pid });
    expect(pidAlive(daemon.pid)).toBe(true);
    // ...while the original still recognises, and escalates, its own daemon.
    expect(await endSession(theirs)).toEqual({ outcome: 'forced', pid: daemon.pid });
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

// #236: daemons started by 0.28.0-0.35.0 carry `--project-root <root>`. After an
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

// #237: daemons started by mauto <= 0.27.x carry no workspace marker at all. One
// too stuck to answer the shutdown used to be reported 'already_stopped' while
// cleanStale (which asks without a root) still respected its lock, so the next
// spawn failed. It is now a failure naming the pid, and it is never signalled.
test("an unanswering marker-less daemon (mauto <= 0.27.x) is unproven, never signalled, never called stopped (#237)", async () => {
  const mine = workspace();
  const daemon = standIn(mine, []);
  try {
    fs.writeFileSync(paths.pidFilePath(mine), `${daemon.pid}\n`);
    fs.writeFileSync(paths.lockPath(mine), `${daemon.pid}\n`);
    expect(await endSession(mine)).toEqual({ outcome: 'unproven', pid: daemon.pid });
    expect(pidAlive(daemon.pid)).toBe(true);
    // Why 'already_stopped' was a lie: the lock is still held as far as a spawn knows.
    expect(cleanStale(mine)).toEqual({ cleaned: false, livePid: daemon.pid });
  } finally {
    killGroup(daemon.pid);
  }
});

// #236: `ps` shows argv to every user on the host, so neither the daemon nor
// the engine it spawns may carry the workspace path. The stand-in mirrors an
// in-project install: both scripts live UNDER the workspace, the daemon is
// started by its argvPath (cwd = workspace) and starts a stand-in engine the
// same way, as createCall does. Every process in the daemon's group is checked,
// so an absolute path on either line fails.
test("no command line in the daemon's process group reveals the workspace path (#236)", async () => {
  const mine = workspace();
  const bin = path.join(mine, 'node_modules', 'mobile-automator', 'bin', 'mauto-session-daemon.js');
  const engineEntry = path.join(mine, 'node_modules', '@mobilenext', 'mobile-mcp', 'lib', 'index.js');
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.mkdirSync(path.dirname(engineEntry), { recursive: true });
  fs.writeFileSync(engineEntry, 'setInterval(() => {}, 1000);\n');
  fs.writeFileSync(
    bin,
    [
      "const { spawn } = require('child_process');",
      `spawn(process.execPath, [${JSON.stringify(paths.argvPath(mine, engineEntry))}], { cwd: ${JSON.stringify(mine)}, stdio: 'ignore' });`,
      "process.on('SIGTERM', () => process.exit(0));",
      'setInterval(() => {}, 1000);',
      '',
    ].join('\n')
  );
  const daemon = spawn(process.execPath, [paths.argvPath(mine, bin), ...paths.daemonArgv(mine, ensureSalt(mine))], {
    cwd: mine,
    detached: true,
    stdio: 'ignore',
  });
  daemon.unref();
  try {
    const group = () =>
      execFileSync('ps', ['-ww', '-axo', 'pgid=,command='], { encoding: 'utf8' })
        .split('\n')
        .map((l) => l.trim().match(/^(\d+)\s+(.*)$/))
        .filter((m) => m && Number(m[1]) === daemon.pid)
        .map((m) => m[2]);
    // Wait for the stand-in engine to appear, or the check below proves nothing.
    const deadline = Date.now() + 5000;
    let lines = group();
    while (lines.length < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      lines = group();
    }
    expect(lines).toHaveLength(2);
    expect(lines.some((l) => /mauto-session-daemon/.test(l))).toBe(true);
    expect(lines.some((l) => l.includes(path.join('mobile-mcp', 'lib', 'index.js')))).toBe(true);
    for (const line of lines) {
      expect(line).not.toContain(mine);
      expect(line).not.toContain(fs.realpathSync(mine));
      expect(line).not.toContain(path.basename(mine));
    }
    expect(paths.commandNamesWorkspace(lines.find((l) => /mauto-session-daemon/.test(l)), mine, readSalt(mine))).toBe(true);
  } finally {
    killGroup(daemon.pid);
  }
});
