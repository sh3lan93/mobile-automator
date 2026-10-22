'use strict';

const path = require('path');

const {
  acquireConnection,
  daemonLogHint,
  isSessionAlive,
  sessionStatus,
  startSession,
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

    const resolveEngine = () => ({ engine: 'mobilecli', source: 'default' });

    test('merges the daemon-reported status with the workspace log path', async () => {
      const client = { getSessionStatus: async () => ({ running: true, in_flight: 2, device: 'A' }) };
      expect(await sessionStatus('/x', { client, resolveEngine })).toEqual({
        running: true,
        reason: null,
        in_flight: 2,
        device: 'A',
        log_path: paths.logFilePath('/x'),
        session_id: null,
        // No handle: a running daemon without a recorded engine is mobilecli.
        engine: 'mobilecli',
        engine_source: null,
        resolved_engine: 'mobilecli',
        resolved_engine_source: 'default',
      });
    });

    // #251: a live daemon reports the engine it was spawned with (handle), and
    // the workspace reports what the next spawn would use (resolution).
    test('reports engine + engine_source from the handle of a running daemon', async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-conn-status-'));
      fs.mkdirSync(paths.sessionDir(root), { recursive: true });
      fs.writeFileSync(paths.handlePath(root), JSON.stringify({ pid: 1, engine: 'legacy', engine_source: 'config' }));
      const client = { getSessionStatus: async () => ({ running: true, in_flight: 0, device: null }) };
      const s = await sessionStatus(root, { client, resolveEngine: () => ({ engine: 'legacy', source: 'config' }) });
      expect(s).toMatchObject({
        engine: 'legacy',
        engine_source: 'config',
        resolved_engine: 'legacy',
        resolved_engine_source: 'config',
      });
    });

    test('reports engine null when not running, but still the resolved engine', async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-conn-status-'));
      fs.mkdirSync(paths.sessionDir(root), { recursive: true });
      fs.writeFileSync(paths.handlePath(root), JSON.stringify({ pid: 1, engine: 'legacy' }));
      const client = { getSessionStatus: async () => ({ running: false, in_flight: null, device: null }) };
      const s = await sessionStatus(root, { client, resolveEngine: () => ({ engine: 'legacy', source: 'env' }) });
      expect(s).toMatchObject({
        engine: null,
        engine_source: null,
        resolved_engine: 'legacy',
        resolved_engine_source: 'env',
      });
    });

    // The load-bearing case. getSessionStatus() collapses EVERY failure branch
    // (no socket, non-ok ping, throw) to the same not-running shape, so a
    // daemon-supplied log path would be absent in precisely the situation that
    // makes the log worth reading. Computing it locally keeps it available.
    test('reports log_path even when no daemon is running (a dead daemon cannot tell us where its log is)', async () => {
      const client = { getSessionStatus: async () => ({ running: false, in_flight: null, device: null }) };
      expect(await sessionStatus('/x', { client, resolveEngine })).toEqual({
        running: false,
        reason: null,
        in_flight: null,
        device: null,
        log_path: paths.logFilePath('/x'),
        session_id: null,
        engine: null,
        engine_source: null,
        resolved_engine: 'mobilecli',
        resolved_engine_source: 'default',
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

    test('passes the engine and its source through to spawnDaemon (#251)', async () => {
      let seen = null;
      const spawn = { spawnDaemon: async (a) => { seen = a; return true; } };
      await startSession({ projectRoot: '/x', device: null, engine: 'legacy', engineSource: 'config', spawn });
      expect(seen).toMatchObject({ projectRoot: '/x', engine: 'legacy', engineSource: 'config' });
    });
  });
});
