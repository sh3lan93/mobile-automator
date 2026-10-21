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

    // --- #251: engine staleness -------------------------------------------
    const base = { alive: true, handleDevice: 'A', requestedDevice: 'A', autostart: true };

    test('live daemon + matching engine -> daemon', () => {
      expect(chooseConnectionStrategy({ ...base, handleEngine: 'legacy', requestedEngine: 'legacy' })).toBe('daemon');
      expect(chooseConnectionStrategy({ ...base, handleEngine: 'mobilecli', requestedEngine: 'mobilecli' })).toBe('daemon');
    });

    test('a handle with no recorded engine (pre-#251 daemon) counts as mobilecli', () => {
      expect(chooseConnectionStrategy({ ...base, handleEngine: null, requestedEngine: 'mobilecli' })).toBe('daemon');
      expect(chooseConnectionStrategy({ ...base, handleEngine: undefined, requestedEngine: 'legacy' })).toBe('restart-then-daemon');
    });

    test('no requested engine -> the engine is not compared (pre-#251 callers)', () => {
      expect(chooseConnectionStrategy({ ...base, handleEngine: 'legacy' })).toBe('daemon');
    });

    test('live daemon + engine mismatch + autostart -> restart-then-daemon', () => {
      expect(chooseConnectionStrategy({ ...base, handleEngine: 'mobilecli', requestedEngine: 'legacy' })).toBe('restart-then-daemon');
      expect(chooseConnectionStrategy({ ...base, requestedDevice: null, handleEngine: 'legacy', requestedEngine: 'mobilecli' })).toBe('restart-then-daemon');
    });

    test('live daemon + engine mismatch + autostart off -> oneshot', () => {
      expect(chooseConnectionStrategy({ ...base, autostart: false, handleEngine: 'mobilecli', requestedEngine: 'legacy' })).toBe('oneshot');
    });

    // Device-pin mismatch keeps its one-shot: restarting would repin the
    // session to the requested device, which is the silent switch (b) refuses.
    test('device AND engine mismatch -> oneshot (the device rule wins)', () => {
      expect(chooseConnectionStrategy({ ...base, requestedDevice: 'B', handleEngine: 'mobilecli', requestedEngine: 'legacy' })).toBe('oneshot');
    });

    test('no daemon -> engine is irrelevant', () => {
      expect(chooseConnectionStrategy({ alive: false, handleDevice: null, requestedDevice: null, autostart: true, handleEngine: 'mobilecli', requestedEngine: 'legacy' })).toBe('spawn-then-daemon');
    });
  });

  // --- #251: the engine reaches every connection path ----------------------
  describe('engine (#251)', () => {
    function writeHandleObj(root, obj) {
      fs.mkdirSync(paths.sessionDir(root), { recursive: true });
      fs.writeFileSync(paths.handlePath(root), JSON.stringify(obj));
    }
    const legacy = () => ({ engine: 'legacy', source: 'config' });
    const mobilecli = () => ({ engine: 'mobilecli', source: 'default' });

    test('one-shot createCall receives the resolved engine', async () => {
      const root = tmpRoot();
      let seen = null;
      const createCall = async (opts) => { seen = opts; return { call: async () => {}, close: async () => {} }; };
      const client = fakeClient({ alive: false });
      await resolveDeviceConnection({ device: 'A', projectRoot: root, autostart: false, client, createCall, resolveEngine: legacy });
      expect(seen).toEqual({ device: 'A', engine: 'legacy' });
    });

    test('spawn-then-daemon passes the engine and its source to spawnDaemon', async () => {
      const root = tmpRoot();
      let seen = null;
      const spawn = { spawnDaemon: async (a) => { seen = a; return true; } };
      const client = fakeClient({ alive: false, conn: fakeDaemonConn() });
      const r = await resolveDeviceConnection({ device: null, projectRoot: root, client, spawn, resolveEngine: legacy, idleMs: 5 });
      expect(r.source).toBe('daemon');
      expect(seen).toEqual({ projectRoot: root, device: null, idleMs: 5, engine: 'legacy', engineSource: 'config' });
    });

    test('a live daemon on the requested engine is reused', async () => {
      const root = tmpRoot();
      writeHandleObj(root, { device: 'A', engine: 'legacy' });
      const client = fakeClient({ alive: true, conn: fakeDaemonConn() });
      const end = async () => { throw new Error('must not end'); };
      const r = await resolveDeviceConnection({ device: 'A', projectRoot: root, client, end, resolveEngine: legacy });
      expect(r.source).toBe('daemon');
    });

    test('a pre-#251 handle (no engine) is reused when mobilecli is requested', async () => {
      const root = tmpRoot();
      writeHandleObj(root, { device: 'A' });
      const client = fakeClient({ alive: true, conn: fakeDaemonConn() });
      const end = async () => { throw new Error('must not end'); };
      const r = await resolveDeviceConnection({ device: 'A', projectRoot: root, client, end, resolveEngine: mobilecli });
      expect(r.source).toBe('daemon');
    });

    test('a stale-engine daemon is ended, then respawned on the requested engine keeping its pin', async () => {
      const root = tmpRoot();
      writeHandleObj(root, { device: 'A', engine: 'mobilecli' });
      const order = [];
      const end = async (r) => { order.push(['end', r]); return { outcome: 'stopped', pid: 1 }; };
      let seen = null;
      const spawn = { spawnDaemon: async (a) => { order.push(['spawn']); seen = a; return true; } };
      const client = fakeClient({ alive: true, conn: fakeDaemonConn() });
      const createCall = async () => { throw new Error('must not one-shot'); };
      // No --device on the verb: the restart must keep the handle's pin (A).
      const r = await resolveDeviceConnection({ device: null, projectRoot: root, client, spawn, createCall, end, resolveEngine: legacy });
      expect(r.source).toBe('daemon');
      expect(order).toEqual([['end', root], ['spawn']]);
      expect(seen).toMatchObject({ projectRoot: root, device: 'A', engine: 'legacy', engineSource: 'config' });
    });

    test('a stale daemon that will not stop -> one-shot on the requested engine, never respawn', async () => {
      const root = tmpRoot();
      writeHandleObj(root, { device: 'A', engine: 'mobilecli' });
      const end = async () => ({ outcome: 'survived', pid: 1 });
      let spawned = 0;
      const spawn = { spawnDaemon: async () => { spawned += 1; return true; } };
      let seen = null;
      const createCall = async (opts) => { seen = opts; return { call: async () => {}, close: async () => {} }; };
      const client = fakeClient({ alive: true, conn: fakeDaemonConn() });
      const r = await resolveDeviceConnection({ device: 'A', projectRoot: root, client, spawn, createCall, end, resolveEngine: legacy });
      expect(r.source).toBe('oneshot');
      expect(spawned).toBe(0);
      expect(seen).toEqual({ device: 'A', engine: 'legacy' });
    });

    test('device AND engine mismatch -> one-shot on the requested engine, the daemon is left alone', async () => {
      const root = tmpRoot();
      writeHandleObj(root, { device: 'A', engine: 'mobilecli' });
      const end = async () => { throw new Error('must not end'); };
      let seen = null;
      const createCall = async (opts) => { seen = opts; return { call: async () => {}, close: async () => {} }; };
      const client = fakeClient({ alive: true, conn: fakeDaemonConn() });
      const r = await resolveDeviceConnection({ device: 'B', projectRoot: root, client, createCall, end, resolveEngine: legacy });
      expect(r.source).toBe('oneshot');
      expect(seen).toEqual({ device: 'B', engine: 'legacy' });
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
