'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { startDaemon } = require('../../../src/device/session-daemon');
const { tryConnect, isAlive, requestShutdown } = require('../../../src/device/session-client');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-client-'));
}

function fakeCreateCall() {
  return async () => ({
    call: async (tool, args) => ({ tool, args }),
    close: async () => {},
  });
}

describe('session-client', () => {
  test('tryConnect returns null when no socket exists', async () => {
    const root = tmpRoot();
    expect(await tryConnect(root)).toBeNull();
  });

  test('isAlive is false when no daemon is running', async () => {
    const root = tmpRoot();
    expect(await isAlive(root)).toBe(false);
  });

  test('tryConnect + call works against an in-process daemon', async () => {
    const root = tmpRoot();
    const daemon = await startDaemon({ projectRoot: root, idleMs: 0, createCall: fakeCreateCall() });
    const conn = await tryConnect(root);
    expect(conn).not.toBeNull();
    const res = await conn.call('mobile_type_keys', { text: 'hi' });
    expect(res).toEqual({ tool: 'mobile_type_keys', args: { text: 'hi' } });
    await conn.close();
    await daemon.stop();
  });

  test('isAlive is true against a live daemon', async () => {
    const root = tmpRoot();
    const daemon = await startDaemon({ projectRoot: root, idleMs: 0, createCall: fakeCreateCall() });
    expect(await isAlive(root)).toBe(true);
    await daemon.stop();
  });

  test('requestShutdown stops a live daemon and returns true', async () => {
    const root = tmpRoot();
    const daemon = await startDaemon({ projectRoot: root, idleMs: 0, createCall: fakeCreateCall() });
    expect(await requestShutdown(root)).toBe(true);
    await daemon.whenStopped;
    expect(await isAlive(root)).toBe(false);
  });

  test('requestShutdown returns false when no daemon is reachable', async () => {
    const root = tmpRoot();
    expect(await requestShutdown(root)).toBe(false);
  });
});
