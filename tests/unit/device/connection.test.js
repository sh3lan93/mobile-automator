'use strict';

const {
  acquireConnection,
  isSessionAlive,
  startSession,
  endSession,
} = require('../../../src/device/connection');

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
