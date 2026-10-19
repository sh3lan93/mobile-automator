'use strict';

const path = require('path');

const {
  acquireConnection,
  daemonLogHint,
  isSessionAlive,
  sessionStatus,
  startSession,
  endSession,
} = require('../../../src/device/connection');
const paths = require('../../../src/device/session-paths');
const sessionLog = require('../../../src/device/session-log');

describe('connection', () => {
  describe('acquireConnection', () => {
    // One fake (the resolver) — no tmpRoot, no handle, no spawn/client stubs.
    test('returns { bridge, close } and hides the resolver source', async () => {
      const resolve = async ({ device, projectRoot }) => ({
        bridge: { device, projectRoot },
        close: async () => {},
        source: 'daemon',
      });
      const r = await acquireConnection({ device: 'A', projectRoot: '/x', resolve });
      expect(r.bridge).toEqual({ device: 'A', projectRoot: '/x' });
      expect(typeof r.close).toBe('function');
      expect(r).not.toHaveProperty('source');
    });

    // cli.js's connectBridge passes autostart:false when no workspace was
    // discovered (#188) so device verbs connect one-shot and create no
    // mobile-automator/.session/ tree; the default stays true so a workspace
    // keeps transparent daemon reuse.
    test('forwards autostart to the resolver, defaulting it to true', async () => {
      const seen = [];
      const resolve = async (args) => {
        seen.push(args);
        return { bridge: {}, close: async () => {} };
      };
      await acquireConnection({ device: null, projectRoot: '/x', resolve });
      await acquireConnection({ device: null, projectRoot: '/x', autostart: false, resolve });
      expect(seen[0]).toMatchObject({ device: null, projectRoot: '/x', autostart: true });
      expect(seen[1]).toMatchObject({ device: null, projectRoot: '/x', autostart: false });
    });
  });

  describe('isSessionAlive', () => {
    test('delegates to the injected client', async () => {
      const client = { isAlive: async (root) => root === '/x' };
      expect(await isSessionAlive('/x', { client })).toBe(true);
      expect(await isSessionAlive('/y', { client })).toBe(false);
    });
  });

  describe('sessionStatus', () => {
    const fs = require('fs');
    const os = require('os');

    test('merges the daemon-reported status with the workspace log path', async () => {
      const client = { getSessionStatus: async () => ({ running: true, in_flight: 2, device: 'A' }) };
      expect(await sessionStatus('/x', { client })).toEqual({
        running: true,
        reason: null,
        in_flight: 2,
        device: 'A',
        log_path: paths.logFilePath('/x'),
        session_id: null,
      });
    });

    // The load-bearing case. getSessionStatus() collapses EVERY failure branch
    // (no socket, non-ok ping, throw) to the same not-running shape, so a
    // daemon-supplied log path would be absent in precisely the situation that
    // makes the log worth reading. Computing it locally keeps it available.
    test('reports log_path even when no daemon is running (a dead daemon cannot tell us where its log is)', async () => {
      const client = { getSessionStatus: async () => ({ running: false, in_flight: null, device: null }) };
      expect(await sessionStatus('/x', { client })).toEqual({
        running: false,
        reason: null,
        in_flight: null,
        device: null,
        log_path: paths.logFilePath('/x'),
        session_id: null,
      });
    });

    test('reports session_id from the handle of a running daemon', async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-conn-status-'));
      fs.mkdirSync(paths.sessionDir(root), { recursive: true });
      fs.writeFileSync(
        paths.handlePath(root),
        JSON.stringify({ pid: 1, session_id: 'abcdef0123456789' }) + '\n'
      );

      const client = { getSessionStatus: async () => ({ running: true, in_flight: 0, device: null }) };
      expect((await sessionStatus(root, { client })).session_id).toBe('abcdef0123456789');
    });

    // Deliberately NOT symmetric with log_path. A SIGKILLed daemon leaves its
    // handle behind, so reporting that id next to running:false would name a
    // session that does not exist.
    test('reports session_id null when not running, even if a stale handle survives', async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-conn-status-'));
      fs.mkdirSync(paths.sessionDir(root), { recursive: true });
      fs.writeFileSync(
        paths.handlePath(root),
        JSON.stringify({ pid: 1, session_id: 'deadbeefdeadbeef' }) + '\n'
      );

      const client = { getSessionStatus: async () => ({ running: false, in_flight: null, device: null }) };
      expect((await sessionStatus(root, { client })).session_id).toBeNull();
    });

    test('passes reason through from the client', async () => {
      const client = { getSessionStatus: async () => ({ running: false, reason: 'engine_exited', in_flight: 0, device: 'A' }) };
      expect((await sessionStatus('/x', { client })).reason).toBe('engine_exited');
    });
  });

  // cli.js already imports this module as its one device facade, so naming the
  // daemon log costs it no new dependency — and in particular no reach into
  // resolve-connection, which owns connection strategy and not log paths.
  describe('daemonLogHint', () => {
    test('is the same function session-log defines, not a second copy of the sentence', () => {
      expect(daemonLogHint).toBe(sessionLog.daemonLogHint);
      expect(daemonLogHint('/x')).toContain(paths.logFilePath('/x'));
    });
  });

  describe('startSession', () => {
    test('delegates to spawnDaemon with the spawn args', async () => {
      let seen = null;
      const spawn = { spawnDaemon: async (a) => { seen = a; return true; } };
      const started = await startSession({ projectRoot: '/x', device: 'A', idleMs: 1000, spawn });
      expect(started).toBe(true);
      expect(seen).toEqual({ projectRoot: '/x', device: 'A', idleMs: 1000 });
    });
  });

  describe('endSession (#156)', () => {
    // Every dependency faked: no socket, no pidfile, no signals.
    function deps({ pid = 4000, acked = true, diesWithin = true, identity = 'ours', outcome = 'dead' } = {}) {
      const log = [];
      return {
        log,
        opts: {
          client: { requestShutdown: async () => { log.push('shutdown'); return acked; } },
          readPid: () => pid,
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
});
