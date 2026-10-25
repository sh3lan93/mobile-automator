'use strict';

// endSession (#156) — every dependency faked: no socket, no pidfile, no
// signals. Moved here from connection.test.js when endSession moved to
// session-end.js; the cases are unchanged.

const { endSession, ENDED_OUTCOMES } = require('../../../src/device/session-end');

describe('session-end', () => {
  describe('endSession (#156)', () => {
    // Every dependency faked: no socket, no pidfile, no signals.
    function deps({ pid = 4000, lockPid = pid, acked = true, diesWithin = true, identity = 'ours', outcome = 'dead' } = {}) {
      const log = [];
      return {
        log,
        opts: {
          client: { requestShutdown: async () => { log.push('shutdown'); return acked; } },
          readPid: () => pid,
          readLockPid: () => { log.push('readLockPid'); return lockPid; },
          identify: (p) => { log.push(['identify', p]); return identity; },
          budgetMs: 35000,
          reaper: {
            waitForDeath: async (p, o) => { log.push(['wait', p, o.budgetMs]); return diesWithin; },
            terminate: async (p, o) => { log.push(['terminate', p, o.group]); return outcome; },
          },
        },
      };
    }
    const ok = { outcome: 'stopped' };
    const none = { outcome: 'already_stopped' };

    test('reads the pid BEFORE asking the daemon to shut down', async () => {
      const order = [];
      const d = deps();
      d.opts.readPid = () => { order.push('readPid'); return 4000; };
      d.opts.client.requestShutdown = async () => { order.push('shutdown'); return true; };
      await endSession('/x', d.opts);
      expect(order).toEqual(['readPid', 'shutdown']);
    });

    test('ack + death within the budget: stopped, not forced', async () => {
      const d = deps();
      expect(await endSession('/x', d.opts)).toEqual({ ...ok, pid: 4000 });
      expect(d.log).toContainEqual(['wait', 4000, 35000]);
      expect(d.log.find((e) => e[0] === 'terminate')).toBeUndefined();
    });

    test('ack + outlives the budget + ours: escalated, forced', async () => {
      const d = deps({ diesWithin: false, identity: 'ours', outcome: 'dead' });
      expect(await endSession('/x', d.opts)).toEqual({ outcome: 'forced', pid: 4000 });
      expect(d.log).toContainEqual(['terminate', 4000, true]);
    });

    test('ack + outlives the budget + survives escalation: failure with pid', async () => {
      const d = deps({ diesWithin: false, identity: 'ours', outcome: 'survived' });
      expect(await endSession('/x', d.opts)).toEqual({ outcome: 'survived', pid: 4000 });
    });

    test('unknown identity is never signalled', async () => {
      const d = deps({ diesWithin: false, identity: 'unknown' });
      expect(await endSession('/x', d.opts)).toEqual({ outcome: 'unverified', pid: 4000 });
      expect(d.log.find((e) => e[0] === 'terminate')).toBeUndefined();
    });

    test('a recycled pid (other) is reported gone, never signalled', async () => {
      const d = deps({ diesWithin: false, identity: 'other' });
      expect(await endSession('/x', d.opts)).toEqual({ ...ok, pid: 4000 });
      expect(d.log.find((e) => e[0] === 'terminate')).toBeUndefined();
    });

    test("another workspace's daemon (foreign) is never signalled; without an ack none of ours was running", async () => {
      const d = deps({ acked: false, diesWithin: false, identity: 'foreign' });
      expect(await endSession('/x', d.opts)).toEqual({ ...none, pid: 4000 });
      expect(d.log.find((e) => e[0] === 'terminate')).toBeUndefined();
    });

    test('an acked daemon that outlives the budget but cannot be tied to this workspace is reported, never signalled', async () => {
      const d = deps({ acked: true, diesWithin: false, identity: 'foreign' });
      expect(await endSession('/x', d.opts)).toEqual({ outcome: 'foreign', pid: 4000 });
      expect(d.log.find((e) => e[0] === 'terminate')).toBeUndefined();
    });

    test('reads the lock pid BEFORE asking the daemon to shut down: a clean exit removes it (#237)', async () => {
      const order = [];
      const d = deps();
      d.opts.readPid = () => { order.push('readPid'); return 4000; };
      d.opts.readLockPid = () => { order.push('readLockPid'); return 4000; };
      d.opts.client.requestShutdown = async () => { order.push('shutdown'); return true; };
      await endSession('/x', d.opts);
      expect(order.indexOf('readLockPid')).toBeGreaterThanOrEqual(0);
      expect(order.indexOf('readLockPid')).toBeLessThan(order.indexOf('shutdown'));
    });

    // #237: a daemon started by mauto <= 0.27.x carries no workspace marker, so
    // its command line proves nothing. An ack does: the socket lives inside this
    // workspace and only the daemon that bound it can answer on it. The lock
    // naming the same pid ties the ack to the pid we are about to signal.
    describe('an unmarked daemon (mauto <= 0.27.x, #237)', () => {
      test('acked, stuck, and the lock names the same pid: force-stopped by a group kill', async () => {
        const d = deps({ diesWithin: false, identity: 'unmarked', outcome: 'dead' });
        expect(await endSession('/x', d.opts)).toEqual({ outcome: 'forced', pid: 4000 });
        expect(d.log).toContainEqual(['terminate', 4000, true]);
      });

      test('acked, stuck, lock matches, but it outlives the escalation: survived', async () => {
        const d = deps({ diesWithin: false, identity: 'unmarked', outcome: 'survived' });
        expect(await endSession('/x', d.opts)).toEqual({ outcome: 'survived', pid: 4000 });
      });

      test('acked but the lock names another pid: reported foreign, never signalled', async () => {
        const d = deps({ diesWithin: false, identity: 'unmarked', lockPid: 4001 });
        expect(await endSession('/x', d.opts)).toEqual({ outcome: 'foreign', pid: 4000 });
        expect(d.log.find((e) => e[0] === 'terminate')).toBeUndefined();
      });

      test('acked but no lock pid: reported foreign, never signalled', async () => {
        const d = deps({ diesWithin: false, identity: 'unmarked', lockPid: null });
        expect(await endSession('/x', d.opts)).toEqual({ outcome: 'foreign', pid: 4000 });
        expect(d.log.find((e) => e[0] === 'terminate')).toBeUndefined();
      });

      test('not acked: unproven, never signalled — and never reported stopped', async () => {
        const d = deps({ acked: false, diesWithin: false, identity: 'unmarked' });
        expect(await endSession('/x', d.opts)).toEqual({ outcome: 'unproven', pid: 4000 });
        expect(d.log.find((e) => e[0] === 'terminate')).toBeUndefined();
      });
    });

    test('the default identity check is bound to this workspace', async () => {
      const processIdentity = require('../../../src/device/process-identity');
      const spy = jest.spyOn(processIdentity, 'pidIdentity').mockReturnValue('other');
      try {
        const d = deps({ acked: false, diesWithin: false });
        delete d.opts.identify;
        await endSession('/x', d.opts);
        expect(spy).toHaveBeenCalledWith(4000, { projectRoot: '/x' });
      } finally {
        spy.mockRestore();
      }
    });

    test('no ack but a live daemon of ours: escalated with budget 0', async () => {
      const d = deps({ acked: false, diesWithin: false, identity: 'ours', outcome: 'dead' });
      expect(await endSession('/x', d.opts)).toEqual({ outcome: 'forced', pid: 4000 });
      expect(d.log).toContainEqual(['wait', 4000, 0]);
    });

    test('no ack and a dead pidfile pid: nothing was running', async () => {
      const d = deps({ acked: false, diesWithin: true });
      expect(await endSession('/x', d.opts)).toEqual({ ...none, pid: 4000 });
    });

    test('no pidfile + ack: stopped (as before)', async () => {
      const d = deps({ pid: null, acked: true });
      expect(await endSession('/x', d.opts)).toEqual({ ...ok, pid: null });
    });

    test('no pidfile + no ack: already stopped (as before)', async () => {
      const d = deps({ pid: null, acked: false });
      expect(await endSession('/x', d.opts)).toEqual({ ...none, pid: null });
    });

    // Review Focus 1: in-process daemon tests write the TEST RUNNER's pid to
    // the pidfile. Waiting on it would burn the budget; signalling it would
    // kill jest.
    test('never signals its own process', async () => {
      const d = deps({ pid: process.pid, diesWithin: false, identity: 'ours' });
      expect(await endSession('/x', d.opts)).toEqual({ ...ok, pid: process.pid });
      expect(d.log.find((e) => e[0] === 'wait' || e[0] === 'terminate')).toBeUndefined();
    });

    test('defaults: a workspace with no pidfile behaves as before', async () => {
      const client = { requestShutdown: async () => true };
      expect(await endSession('/nonexistent-mauto-root', { client })).toEqual({ ...ok, pid: null });
    });
  });

  // The classification the stale-engine restart reads (#251): exactly the
  // outcomes after which no daemon of ours holds the workspace. Kept beside
  // the vocabulary it classifies so drift is a test failure, not a silent
  // misclassification into the one-shot fallback.
  describe('ENDED_OUTCOMES (#251)', () => {
    test('classifies exactly the outcomes that leave nothing of ours running', () => {
      expect([...ENDED_OUTCOMES].sort()).toEqual(['already_stopped', 'forced', 'stopped']);
      for (const outcome of ['survived', 'foreign', 'unverified', 'unproven']) {
        expect(ENDED_OUTCOMES.has(outcome)).toBe(false);
      }
    });
  });
});
