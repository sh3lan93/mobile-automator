'use strict';

// The fake process table cannot show that -pid reaches a GRANDCHILD — the
// mobile-mcp engine under a daemon. This spawns a real detached leader with a
// real child of its own and kills the group.

const { spawn } = require('child_process');
const { terminate, waitForDeath } = require('../../src/device/process-reaper');
const { pidAlive } = require('../../src/device/process-identity');

jest.setTimeout(15000);

// Leader prints its child's pid, then both idle forever.
const LEADER = `
  const { spawn } = require('child_process');
  const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  process.stdout.write(String(c.pid) + '\\n');
  setInterval(() => {}, 1000);
`;

function startTree() {
  return new Promise((resolve, reject) => {
    const leader = spawn(process.execPath, ['-e', LEADER], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
    leader.on('error', reject);
    leader.stdout.once('data', (buf) => resolve({ leader, childPid: Number(String(buf).trim()) }));
  });
}

test('terminate(group) kills the leader and its child', async () => {
  const { leader, childPid } = await startTree();
  expect(pidAlive(leader.pid)).toBe(true);
  expect(pidAlive(childPid)).toBe(true);

  expect(await terminate(leader.pid, { group: true, graceMs: 2000 })).toBe('dead');
  // The orphaned child is reparented and reaped by init; give it a moment.
  expect(await waitForDeath(childPid, { budgetMs: 3000 })).toBe(true);
});

test('terminate(group:false) kills only the pid', async () => {
  const { leader, childPid } = await startTree();
  try {
    expect(await terminate(childPid, { group: false, graceMs: 2000 })).toBe('dead');
    expect(pidAlive(leader.pid)).toBe(true);
  } finally {
    await terminate(leader.pid, { group: true });
  }
});

// #156 regression: the shape of the spawn-timeout kill. The leader has no
// SIGTERM handler (a daemon before listen()), so it dies at once; its child
// ignores SIGTERM (an engine whose handler cannot run on a blocked loop). The
// group kill must still reach the child.
test('terminate(group) SIGKILLs a member that outlives SIGTERM after the leader died', async () => {
  const leaderSrc = `
    const { spawn } = require('child_process');
    const c = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore' });
    process.stdout.write(String(c.pid) + '\\n');
    setInterval(() => {}, 1000);
  `;
  const { leader, childPid } = await new Promise((resolve, reject) => {
    const l = spawn(process.execPath, ['-e', leaderSrc], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
    l.on('error', reject);
    l.stdout.once('data', (buf) => resolve({ leader: l, childPid: Number(String(buf).trim()) }));
  });
  try {
    // Let the child install its SIGTERM handler before we signal.
    await new Promise((r) => setTimeout(r, 300));
    expect(await terminate(leader.pid, { group: true, graceMs: 1000 })).toBe('dead');
    expect(await waitForDeath(childPid, { budgetMs: 3000 })).toBe(true);
  } finally {
    try {
      process.kill(childPid, 'SIGKILL');
    } catch (_) {
      /* already gone */
    }
  }
});

// #156 regression: a real zombie. `exec sleep` replaces the shell and sleep
// never reaps, so the backgrounded child stays a zombie until its parent exits —
// the state an exited daemon is left in under a PID 1 that does not reap.
test('waitForDeath treats a zombie as dead instead of waiting out its budget', async () => {
  const parent = spawn('sh', ['-c', 'sleep 0.1 & echo $!; exec sleep 5'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const zombie = await new Promise((resolve) => parent.stdout.once('data', (b) => resolve(Number(String(b).trim()))));
  try {
    await new Promise((r) => setTimeout(r, 500)); // the child has exited by now
    expect(pidAlive(zombie)).toBe(true); // kill(pid, 0) still succeeds on a zombie
    const started = Date.now();
    expect(await waitForDeath(zombie, { budgetMs: 3000 })).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  } finally {
    parent.kill('SIGKILL');
  }
});

