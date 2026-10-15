'use strict';

// The fake process table cannot show that -pid reaches a GRANDCHILD — the
// mobile-mcp engine under a daemon. This spawns a real detached leader with a
// real child of its own and kills the group.

const { spawn } = require('child_process');
const { terminate, waitForDeath } = require('../../src/device/process-reaper');
const { pidAlive } = require('../../src/device/session-daemon');

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
