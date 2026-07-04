'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  resolveDeviceConnection,
  chooseConnectionStrategy,
  deviceMatches,
} = require('../../../src/device/resolve-connection');
const paths = require('../../../src/device/session-paths');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-resolve-'));
}

// Write a handle so readHandleDevice() reflects the daemon's device pin.
function writeHandle(root, device) {
  fs.mkdirSync(paths.sessionDir(root), { recursive: true });
  fs.writeFileSync(paths.handlePath(root), JSON.stringify({ device: device || null }));
}

function fakeClient({ alive = false, conn = null } = {}) {
  const calls = { tryConnect: 0, isAlive: 0 };
  return {
    calls,
    async isAlive() {
      calls.isAlive += 1;
      return alive;
    },
    async tryConnect() {
      calls.tryConnect += 1;
      return conn;
    },
    async requestShutdown() {
      return false;
    },
  };
}

function fakeDaemonConn() {
  const state = { closed: 0 };
  return {
    state,
    call: async (tool, args) => ({ tool, args }),
    close: async () => {
      state.closed += 1;
    },
  };
}

describe('resolve-connection', () => {
  describe('deviceMatches', () => {
    test('no requested device reuses any daemon', () => {
      expect(deviceMatches(null, 'A')).toBe(true);
      expect(deviceMatches(null, null)).toBe(true);
    });
    test('requested device must equal the daemon pin', () => {
      expect(deviceMatches('A', 'A')).toBe(true);
      expect(deviceMatches('B', 'A')).toBe(false);
      expect(deviceMatches('A', null)).toBe(false);
    });
  });

  // The pure chooser needs NO tmpRoot, NO writeHandle, NO fakes — just values.
  describe('chooseConnectionStrategy (pure)', () => {
    test('live daemon + matching pin -> daemon', () => {
      expect(chooseConnectionStrategy({ alive: true, handleDevice: 'A', requestedDevice: 'A', autostart: true })).toBe('daemon');
      expect(chooseConnectionStrategy({ alive: true, handleDevice: 'A', requestedDevice: null, autostart: true })).toBe('daemon');
      expect(chooseConnectionStrategy({ alive: true, handleDevice: null, requestedDevice: null, autostart: false })).toBe('daemon');
    });
    test('live daemon + pin mismatch -> oneshot (regardless of autostart)', () => {
      expect(chooseConnectionStrategy({ alive: true, handleDevice: 'A', requestedDevice: 'B', autostart: true })).toBe('oneshot');
      expect(chooseConnectionStrategy({ alive: true, handleDevice: null, requestedDevice: 'B', autostart: false })).toBe('oneshot');
    });
    test('no daemon + autostart -> spawn-then-daemon', () => {
      expect(chooseConnectionStrategy({ alive: false, handleDevice: null, requestedDevice: 'A', autostart: true })).toBe('spawn-then-daemon');
    });
    test('no daemon + autostart off -> oneshot', () => {
      expect(chooseConnectionStrategy({ alive: false, handleDevice: null, requestedDevice: null, autostart: false })).toBe('oneshot');
    });
  });

  test('(a) daemon live + device match -> source daemon, close is a no-op for the daemon', async () => {
    const root = tmpRoot();
    writeHandle(root, 'A');
    const conn = fakeDaemonConn();
    const client = fakeClient({ alive: true, conn });

    let spawned = 0;
    const spawn = { spawnDaemon: async () => { spawned += 1; return true; } };
    let oneShotBuilt = 0;
    const createCall = async () => { oneShotBuilt += 1; return { call: async () => {}, close: async () => {} }; };

    const r = await resolveDeviceConnection({ device: 'A', projectRoot: root, client, spawn, createCall });
    expect(r.source).toBe('daemon');
    expect(spawned).toBe(0);
    expect(oneShotBuilt).toBe(0);

    // close() releases this socket but never stops the shared daemon: the fake
    // daemon connection is only ended, not "stopped".
    await r.close();
    expect(conn.state.closed).toBe(1); // socket released
  });

  test('(b) device-pin mismatch -> source oneshot (does not reuse the daemon)', async () => {
    const root = tmpRoot();
    writeHandle(root, 'A');
    const conn = fakeDaemonConn();
    const client = fakeClient({ alive: true, conn });
    let oneShotBuilt = 0;
    const createCall = async () => { oneShotBuilt += 1; return { call: async () => {}, close: async () => {} }; };
    const spawn = { spawnDaemon: async () => true };

    const r = await resolveDeviceConnection({ device: 'B', projectRoot: root, client, spawn, createCall });
    expect(r.source).toBe('oneshot');
    expect(oneShotBuilt).toBe(1);
    expect(client.calls.tryConnect).toBe(0); // never reused the wrong daemon
  });

  test('(c) no daemon + autostart -> spawns once then connects daemon-backed', async () => {
    const root = tmpRoot();
    const conn = fakeDaemonConn();
    // isAlive starts false; after spawn, tryConnect succeeds.
    const client = fakeClient({ alive: false, conn });
    let spawned = 0;
    const spawn = { spawnDaemon: async () => { spawned += 1; return true; } };
    const createCall = async () => ({ call: async () => {}, close: async () => {} });

    const r = await resolveDeviceConnection({ device: null, projectRoot: root, client, spawn, createCall });
    expect(spawned).toBe(1);
    expect(r.source).toBe('daemon');
  });

  test('(d) spawn fails -> one-shot fallback with the real (transport-tearing) close', async () => {
    const root = tmpRoot();
    const client = fakeClient({ alive: false, conn: null });
    const spawn = { spawnDaemon: async () => false };
    const state = { closed: 0 };
    const createCall = async () => ({ call: async () => {}, close: async () => { state.closed += 1; } });

    const r = await resolveDeviceConnection({ device: null, projectRoot: root, client, spawn, createCall });
    expect(r.source).toBe('oneshot');
    await r.close();
    expect(state.closed).toBe(1); // one-shot close tears the transport down
  });

  test('autostart:false -> straight one-shot, never spawns', async () => {
    const root = tmpRoot();
    const client = fakeClient({ alive: false, conn: null });
    let spawned = 0;
    const spawn = { spawnDaemon: async () => { spawned += 1; return true; } };
    const createCall = async () => ({ call: async () => {}, close: async () => {} });

    const r = await resolveDeviceConnection({ device: null, projectRoot: root, autostart: false, client, spawn, createCall });
    expect(r.source).toBe('oneshot');
    expect(spawned).toBe(0);
  });
});
