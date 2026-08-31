'use strict';

const {
  acquireConnection,
  isSessionAlive,
  sessionStatus,
  startSession,
  endSession,
} = require('../../../src/device/connection');
const paths = require('../../../src/device/session-paths');

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
  });

  describe('isSessionAlive', () => {
    test('delegates to the injected client', async () => {
      const client = { isAlive: async (root) => root === '/x' };
      expect(await isSessionAlive('/x', { client })).toBe(true);
      expect(await isSessionAlive('/y', { client })).toBe(false);
    });
  });

  describe('sessionStatus', () => {
    test('merges the daemon-reported status with the workspace log path', async () => {
      const client = { getSessionStatus: async () => ({ running: true, in_flight: 2, device: 'A' }) };
      expect(await sessionStatus('/x', { client })).toEqual({
        running: true,
        in_flight: 2,
        device: 'A',
        log_path: paths.logFilePath('/x'),
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
        in_flight: null,
        device: null,
        log_path: paths.logFilePath('/x'),
      });
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

  describe('endSession', () => {
    test('delegates to the client requestShutdown', async () => {
      const client = { requestShutdown: async () => true };
      expect(await endSession('/x', { client })).toBe(true);
    });
  });
});
