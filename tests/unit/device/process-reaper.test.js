'use strict';

const { waitForDeath, terminate } = require('../../../src/device/process-reaper');

// A fake process table plus a fake clock. `kill(target, sig)` addresses -pid
// (group) or pid; each process lists the signals it dies on.
function world(procs) {
  let t = 0;
  const sent = [];
  const table = new Map(Object.entries(procs).map(([pid, p]) => [Number(pid), { alive: true, ...p }]));
  const kill = (target, sig) => {
    sent.push([target, sig]);
    const pid = Math.abs(target);
    const p = table.get(pid);
    if (p && p.eperm) {
      const e = new Error('EPERM');
      e.code = 'EPERM';
      throw e;
    }
    // A non-leader has no group: -pid is ESRCH even though pid lives.
    if (!p || !p.alive || (target < 0 && p.notLeader)) {
      const e = new Error('ESRCH');
      e.code = 'ESRCH';
      throw e;
    }
    if ((p.diesOn || []).includes(sig)) p.alive = false;
  };
  const isAlive = (pid) => {
    const p = table.get(pid);
    return !!(p && p.alive);
  };
  const now = () => t;
  const sleep = async (ms) => {
    t += ms;
  };
  return { kill, isAlive, now, sleep, sent, table };
}

describe('waitForDeath', () => {
  test('true as soon as the pid is dead', async () => {
    const w = world({ 7: { alive: false } });
    expect(await waitForDeath(7, { budgetMs: 1000, ...w })).toBe(true);
  });

  test('false once the budget elapses for a live pid', async () => {
    const w = world({ 7: {} });
    expect(await waitForDeath(7, { budgetMs: 300, pollMs: 100, ...w })).toBe(false);
    expect(w.now()).toBeGreaterThanOrEqual(300);
  });

  test('budget 0 is a single check', async () => {
    const w = world({ 7: {} });
    expect(await waitForDeath(7, { budgetMs: 0, ...w })).toBe(false);
    expect(w.now()).toBe(0);
  });

  test('true when the pid dies mid-budget', async () => {
    const w = world({ 7: {} });
    const sleep = async (ms) => {
      await w.sleep(ms);
      if (w.now() >= 200) w.table.get(7).alive = false;
    };
    expect(await waitForDeath(7, { budgetMs: 1000, pollMs: 100, ...w, sleep })).toBe(true);
  });
});

describe('terminate', () => {
  test('SIGTERM suffices: no SIGKILL is sent', async () => {
    const w = world({ 9: { diesOn: ['SIGTERM'] } });
    expect(await terminate(9, { ...w })).toBe('dead');
    expect(w.sent).toEqual([[-9, 'SIGTERM']]);
  });

  test('ignores SIGTERM: SIGKILL after the grace', async () => {
    const w = world({ 9: { diesOn: ['SIGKILL'] } });
    expect(await terminate(9, { graceMs: 2000, ...w })).toBe('dead');
    expect(w.sent).toEqual([[-9, 'SIGTERM'], [-9, 'SIGKILL']]);
    expect(w.now()).toBeGreaterThanOrEqual(2000);
  });

  test('survives both signals: survived', async () => {
    const w = world({ 9: { diesOn: [] } });
    expect(await terminate(9, { ...w })).toBe('survived');
  });

  test('already gone (ESRCH, pid dead): dead, without waiting', async () => {
    const w = world({ 9: { alive: false } });
    expect(await terminate(9, { ...w })).toBe('dead');
    expect(w.now()).toBe(0);
  });

  test('ESRCH on the group while the pid lives is not death', async () => {
    const w = world({ 9: { notLeader: true, diesOn: ['SIGTERM'] } });
    expect(await terminate(9, { group: true, ...w })).toBe('survived');
  });

  test('EPERM: survived, no SIGKILL attempted', async () => {
    const w = world({ 9: { eperm: true } });
    expect(await terminate(9, { ...w })).toBe('survived');
    expect(w.sent).toEqual([[-9, 'SIGTERM']]);
  });

  test('group:false signals the pid, not the group', async () => {
    const w = world({ 9: { notLeader: true, diesOn: ['SIGTERM'] } });
    expect(await terminate(9, { group: false, ...w })).toBe('dead');
    expect(w.sent).toEqual([[9, 'SIGTERM']]);
  });

  test('rejects a non-positive pid instead of signalling a whole session', async () => {
    const w = world({});
    await expect(terminate(0, { ...w })).rejects.toThrow(TypeError);
    await expect(terminate(-5, { ...w })).rejects.toThrow(TypeError);
    expect(w.sent).toEqual([]);
  });
});
