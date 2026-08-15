'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const { startDaemon } = require('../../../src/device/session-daemon');
const { tryConnect, isAlive, requestShutdown, getSessionStatus } = require('../../../src/device/session-client');
const paths = require('../../../src/device/session-paths');
const { FrameParser } = require('../../../src/device/session-protocol');

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

  test('getSessionStatus reports running:false with nulls when no daemon is up', async () => {
    const root = tmpRoot();
    expect(await getSessionStatus(root)).toEqual({ running: false, in_flight: null, device: null });
  });

  test('getSessionStatus reports running:true with in_flight and device against a live daemon', async () => {
    const root = tmpRoot();
    const daemon = await startDaemon({ projectRoot: root, device: 'emulator-5554', idleMs: 0, createCall: fakeCreateCall() });
    expect(await getSessionStatus(root)).toEqual({ running: true, in_flight: 0, device: 'emulator-5554' });
    await daemon.stop();
  });

  test('call propagates kind + hint from an ok:false reply', async () => {
    const root = tmpRoot();
    fs.mkdirSync(paths.sessionDir(root), { recursive: true });
    // A fake daemon that answers every call frame with a typed error reply.
    const server = net.createServer((socket) => {
      const parser = new FrameParser();
      socket.setEncoding('utf8');
      socket.on('data', (chunk) => {
        for (const f of parser.push(chunk)) {
          if (f.value && f.value.type === 'call') {
            socket.write(
              FrameParser.encode({
                id: f.value.id,
                ok: false,
                error: { message: 'x', kind: 'timeout', hint: 'h' },
              })
            );
          }
        }
      });
    });
    await new Promise((resolve) => server.listen(paths.socketPath(root), resolve));

    const conn = await tryConnect(root);
    let err = null;
    try {
      await conn.call('mobile_press_button', {});
    } catch (e) {
      err = e;
    }
    expect(err).not.toBeNull();
    expect(err.message).toBe('x');
    expect(err.kind).toBe('timeout');
    expect(err.hint).toBe('h');

    await conn.close();
    await new Promise((resolve) => server.close(resolve));
  });
});
