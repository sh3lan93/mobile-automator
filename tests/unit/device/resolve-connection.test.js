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

  // --- #163: a failed spawn must point the user at the daemon log ---------
  //
  // Transparent autostart is the COMMON path (most users never type
  // `mauto session start`), and until now a dead daemon fell through to the
  // one-shot silently. The signal rides err.hint because that is the channel
  // deviceFail() in cli.js already surfaces on every device verb.
  test('(d) spawn failed + one-shot throws -> the error carries a hint naming the daemon log', async () => {
    const root = tmpRoot();
    const client = fakeClient({ alive: false, conn: null });
    const spawn = { spawnDaemon: async () => false };
    const createCall = async () => { throw new Error('no device'); };

    await expect(
      resolveDeviceConnection({ device: null, projectRoot: root, client, spawn, createCall })
    ).rejects.toMatchObject({
      message: 'no device',
      hint: expect.stringContaining(paths.logFilePath(root)),
    });
  });

  test('(d) spawn failed -> an error that already carries its own hint keeps it', async () => {
    const root = tmpRoot();
    const client = fakeClient({ alive: false, conn: null });
    const spawn = { spawnDaemon: async () => false };
    const createCall = async () => {
      const err = new Error('no device');
      err.hint = 'Plug in a phone.';
      throw err;
    };

    await expect(
      resolveDeviceConnection({ device: null, projectRoot: root, client, spawn, createCall })
    ).rejects.toMatchObject({ hint: 'Plug in a phone.' });
  });

  // The daemon started fine here — it just wasn't reachable in time. Its log
  // has nothing to say about the one-shot's failure, so pointing at it would
  // be a false lead.
  test('spawn succeeded but the daemon connect yielded null -> no daemon-log hint on a one-shot failure', async () => {
    const root = tmpRoot();
    const client = fakeClient({ alive: false, conn: null }); // tryConnect -> null
    const spawn = { spawnDaemon: async () => true };
    const createCall = async () => { throw new Error('no device'); };

    let thrown = null;
    try {
      await resolveDeviceConnection({ device: null, projectRoot: root, client, spawn, createCall });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).not.toBeNull();
    expect(thrown.hint).toBeUndefined();
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
