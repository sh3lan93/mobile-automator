'use strict';

// #156: the daemon reaps itself when its engine dies, instead of living on as
// a zombie that answers ping and can never serve a call.

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const { startDaemon } = require('../../../src/device/session-daemon');
const sessionClient = require('../../../src/device/session-client');
const paths = require('../../../src/device/session-paths');
const { FrameParser } = require('../../../src/device/session-protocol');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-engine-exit-'));
}

function collector() {
  const events = [];
  const observe = (fields) => events.push(fields);
  observe.events = events;
  observe.names = () => events.map((e) => e.event);
  return observe;
}

// Stub engine: captures onEngineExit; `gate` lets a call hang until released.
function engineStub({ exitDuringConnect = false } = {}) {
  const s = { exit: null, closed: 0, release: null };
  const createCall = async ({ onEngineExit } = {}) => {
    s.exit = onEngineExit;
    if (exitDuringConnect) onEngineExit();
    return {
      call: async (tool) => {
        if (tool === 'hang') {
          await new Promise((_, reject) => { s.release = reject; });
        }
        return { tool };
      },
      close: async () => { s.closed += 1; },
    };
  };
  return { createCall, s };
}

function rawPing(root) {
  return new Promise((resolve, reject) => {
    const parser = new FrameParser();
    const sock = net.createConnection(paths.socketPath(root));
    sock.setEncoding('utf8');
    sock.on('error', reject);
    sock.on('connect', () => sock.write(FrameParser.encode({ id: 1, type: 'ping' })));
    sock.on('data', (chunk) => {
      for (const f of parser.push(chunk)) {
        if (f.value && f.value.id === 1) { sock.end(); resolve(f.value); }
      }
    });
  });
}

const gone = (root) =>
  [paths.lockPath(root), paths.pidFilePath(root), paths.handlePath(root)].filter((p) => fs.existsSync(p));

describe('daemon engine exit (#156)', () => {
  test('ping reports engine_alive:true while the engine is up', async () => {
    const root = tmpRoot();
    const { createCall } = engineStub();
    const daemon = await startDaemon({ projectRoot: root, createCall });
    const res = await rawPing(root);
    expect(res.result.engine_alive).toBe(true);
    await daemon.stop();
  });

  test('an engine exit stops the daemon, frees its files, and is recorded first', async () => {
    const root = tmpRoot();
    const obs = collector();
    const { createCall, s } = engineStub();
    const daemon = await startDaemon({ projectRoot: root, createCall, recorderFor: () => obs });

    s.exit();
    await daemon.whenStopped;

    expect(gone(root)).toEqual([]);
    const names = obs.names();
    expect(names).toContain('daemon.engine_exit');
    expect(names.indexOf('daemon.engine_exit')).toBeLessThan(names.indexOf('daemon.stop'));
    expect(obs.events.find((e) => e.event === 'daemon.engine_exit').level).toBe('error');
    expect(obs.events.find((e) => e.event === 'daemon.stop').stop_reason).toBe('engine_exit');
  });

  test('an in-flight call gets its error reply before teardown; ping during the drain says engine_alive:false', async () => {
    const root = tmpRoot();
    const { createCall, s } = engineStub();
    const daemon = await startDaemon({ projectRoot: root, createCall });

    const conn = await sessionClient.tryConnect(root);
    const pending = conn.call('hang', {}).catch((e) => e);
    while (!s.release) await new Promise((r) => setTimeout(r, 5));

    s.exit(); // stop() now drains the hung call
    const ping = await rawPing(root);
    expect(ping.result.engine_alive).toBe(false);

    s.release(new Error('Connection closed')); // what the SDK does to pending calls
    const err = await pending;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('Connection closed');

    await daemon.whenStopped;
    await conn.close();
  });

  test('an engine that dies before the daemon is serving fails the start and writes no handle', async () => {
    const root = tmpRoot();
    const obs = collector();
    const { createCall, s } = engineStub({ exitDuringConnect: true });
    const err = await startDaemon({ projectRoot: root, createCall, recorderFor: () => obs }).catch((e) => e);

    expect(err.code).toBe('ENGINE_EXITED');
    expect(gone(root)).toEqual([]);
    expect(s.closed).toBe(1);
    const failure = obs.events.find((e) => e.event === 'daemon.connect_failure');
    expect(failure.error_code).toBe('ENGINE_EXITED');
    expect(obs.names()).not.toContain('daemon.start');
  });

  test('a normal shutdown frame records no engine_exit', async () => {
    const root = tmpRoot();
    const obs = collector();
    const { createCall } = engineStub();
    const daemon = await startDaemon({ projectRoot: root, createCall, recorderFor: () => obs });
    expect(await sessionClient.requestShutdown(root)).toBe(true);
    await daemon.whenStopped;
    expect(obs.names()).not.toContain('daemon.engine_exit');
  });

  test('a second engine-exit signal is a no-op', async () => {
    const root = tmpRoot();
    const obs = collector();
    const { createCall, s } = engineStub();
    const daemon = await startDaemon({ projectRoot: root, createCall, recorderFor: () => obs });
    s.exit();
    s.exit();
    await daemon.whenStopped;
    expect(obs.names().filter((n) => n === 'daemon.engine_exit')).toHaveLength(1);
  });
});
