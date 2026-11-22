'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const { startDaemon } = require('../../../src/device/session-daemon');
const { tryConnect, isAlive, requestShutdown, getSessionStatus } = require('../../../src/device/session-client');
const paths = require('../../../src/device/session-paths');
const { ensureSessionDirs } = require('../../../src/device/session-dir');
const { FrameParser } = require('../../../src/device/session-protocol');
const { useSocketDeps } = require('../../helpers/socket-deps');

// A deep temp root's socket goes to the fallback directory: keep it in a
// temp dir of this file's, never the real per-user one (#346).
const socketDeps = useSocketDeps();

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
    expect(await tryConnect(root, socketDeps())).toBeNull();
  });

  test('isAlive is false when no daemon is running', async () => {
    const root = tmpRoot();
    expect(await isAlive(root, socketDeps())).toBe(false);
  });

  test('tryConnect + call works against an in-process daemon', async () => {
    const root = tmpRoot();
    const daemon = await startDaemon({ socketDeps: socketDeps(), projectRoot: root, idleMs: 0, createCall: fakeCreateCall() });
    const conn = await tryConnect(root, socketDeps());
    expect(conn).not.toBeNull();
    const res = await conn.call('mobile_type_keys', { text: 'hi' });
    expect(res).toEqual({ tool: 'mobile_type_keys', args: { text: 'hi' } });
    await conn.close();
    await daemon.stop();
  });

  test('isAlive is true against a live daemon', async () => {
    const root = tmpRoot();
    const daemon = await startDaemon({ socketDeps: socketDeps(), projectRoot: root, idleMs: 0, createCall: fakeCreateCall() });
    expect(await isAlive(root, socketDeps())).toBe(true);
    await daemon.stop();
  });

  test('requestShutdown stops a live daemon and returns true', async () => {
    const root = tmpRoot();
    const daemon = await startDaemon({ socketDeps: socketDeps(), projectRoot: root, idleMs: 0, createCall: fakeCreateCall() });
    expect(await requestShutdown(root, socketDeps())).toBe(true);
    await daemon.whenStopped;
    expect(await isAlive(root, socketDeps())).toBe(false);
  });

  test('requestShutdown returns false when no daemon is reachable', async () => {
    const root = tmpRoot();
    expect(await requestShutdown(root, socketDeps())).toBe(false);
  });

  test('getSessionStatus reports running:false with nulls when no daemon is up', async () => {
    const root = tmpRoot();
    expect(await getSessionStatus(root, socketDeps())).toEqual({ running: false, reason: null, in_flight: null, device: null });
  });

  test('getSessionStatus reports running:true with in_flight and device against a live daemon', async () => {
    const root = tmpRoot();
    const daemon = await startDaemon({ socketDeps: socketDeps(), projectRoot: root, device: 'emulator-5554', idleMs: 0, createCall: fakeCreateCall() });
    expect(await getSessionStatus(root, socketDeps())).toEqual({ running: true, reason: null, in_flight: 0, device: 'emulator-5554' });
    await daemon.stop();
  });

  // A server speaking the daemon protocol with a chosen ping result.
  function fakeDaemon(root, result) {
    const sock = paths.socketPath(root, socketDeps());
    ensureSessionDirs(root, socketDeps());
    const server = net.createServer((s) => {
      const parser = new FrameParser();
      s.setEncoding('utf8');
      s.on('data', (chunk) => {
        for (const f of parser.push(chunk)) {
          if (f.value) s.write(FrameParser.encode({ id: f.value.id, ok: true, result }));
        }
      });
    });
    return new Promise((resolve) => server.listen(sock, () => resolve(server)));
  }

  test('getSessionStatus reports running:false + engine_exited when the engine is dead (#156)', async () => {
    const root = tmpRoot();
    const server = await fakeDaemon(root, { pong: true, device: 'A', in_flight: 1, engine_alive: false });
    try {
      expect(await getSessionStatus(root, socketDeps())).toEqual({ running: false, reason: 'engine_exited', in_flight: 1, device: 'A' });
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  // Review Focus 2: a 0.27.x daemon still running across the upgrade.
  test('a pre-0.28 daemon without engine_alive is running', async () => {
    const root = tmpRoot();
    const server = await fakeDaemon(root, { pong: true, device: null, in_flight: 0 });
    try {
      expect(await getSessionStatus(root, socketDeps())).toEqual({ running: true, reason: null, in_flight: 0, device: null });
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  test('call propagates kind + hint from an ok:false reply', async () => {
    const root = tmpRoot();
    ensureSessionDirs(root, socketDeps());
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
    await new Promise((resolve) => server.listen(paths.socketPath(root, socketDeps()), resolve));

    const conn = await tryConnect(root, socketDeps());
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

// The client connects only to a socket it can vouch for (#346): its directory
// is private and the socket itself is a real socket of ours.
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const maybe = isRoot ? test.skip : test;

// A listener that answers ping/shutdown and counts every connection made to it.
function countingServer() {
  const state = { connections: 0 };
  state.server = net.createServer((socket) => {
    state.connections += 1;
    const parser = new FrameParser();
    socket.setEncoding('utf8');
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      for (const f of parser.push(chunk)) {
        if (!f.value) continue;
        socket.write(FrameParser.encode({ id: f.value.id, ok: true, result: {} }));
      }
    });
  });
  state.listen = (p) => new Promise((resolve) => state.server.listen(p, resolve));
  state.close = () => new Promise((resolve) => state.server.close(resolve));
  return state;
}

// A root whose in-workspace socket fits the sockaddr limit, or one too deep
// for it (fallback location). The short base is a hard-coded /tmp, not
// os.tmpdir(): macOS's long tmpdir pushes the in-workspace socket past the limit.
function shortRoot() {
  const root = fs.mkdtempSync(path.join('/tmp', 'mc-'));
  expect(paths.socketLocation(root, socketDeps()).inWorkspace).toBe(true);
  return root;
}
function deepRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-client-deep-'.padEnd(60, 'x')));
  expect(paths.socketLocation(root, socketDeps()).inWorkspace).toBe(false);
  return root;
}

const DOWN = { running: false, reason: null, in_flight: null, device: null };

describe('session-client socket verification', () => {
  async function drive(root) {
    const conn = await tryConnect(root, socketDeps());
    if (conn) await conn.close();
    return {
      conn,
      alive: await isAlive(root, socketDeps()),
      shutdown: await requestShutdown(root, socketDeps()),
      status: await getSessionStatus(root, socketDeps()),
    };
  }

  function expectRefused(r) {
    expect(r.conn).toBeNull();
    expect(r.alive).toBe(false);
    expect(r.shutdown).toBe(false);
    expect(r.status).toEqual(DOWN);
  }

  describe.each([
    ['in-workspace', shortRoot],
    ['fallback', deepRoot],
  ])('symlinked socket (%s)', (_name, makeRoot) => {
    maybe('is never connected to', async () => {
      const root = makeRoot();
      const outside = fs.mkdtempSync(path.join('/tmp', 'mo-'));
      const srv = countingServer();
      try {
        ensureSessionDirs(root, socketDeps());
        const real = path.join(outside, 'real.sock');
        await srv.listen(real);
        fs.symlinkSync(real, paths.socketPath(root, socketDeps()));

        expectRefused(await drive(root));
        expect(srv.connections).toBe(0);
      } finally {
        await srv.close();
        fs.rmSync(outside, { recursive: true, force: true });
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  maybe('in-workspace: a 0755 .session/ is refused, then ensureSessionDirs tightens it and the daemon is reachable', async () => {
    const root = shortRoot();
    const srv = countingServer();
    try {
      ensureSessionDirs(root, socketDeps());
      const dir = paths.sessionDir(root);
      await srv.listen(paths.socketPath(root, socketDeps()));
      fs.chmodSync(dir, 0o755);

      expectRefused(await drive(root));
      expect(srv.connections).toBe(0);

      ensureSessionDirs(root, socketDeps());
      expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
      expect(await isAlive(root, socketDeps())).toBe(true);
      expect(srv.connections).toBe(1);
    } finally {
      await srv.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  maybe('fallback: a 0755 socket directory is refused and never chmodded (D-b)', async () => {
    const root = deepRoot();
    const srv = countingServer();
    try {
      ensureSessionDirs(root, socketDeps());
      const dir = path.dirname(paths.socketPath(root, socketDeps()));
      await srv.listen(paths.socketPath(root, socketDeps()));
      fs.chmodSync(dir, 0o755);

      expectRefused(await drive(root));
      expect(srv.connections).toBe(0);

      let err = null;
      try {
        ensureSessionDirs(root, socketDeps());
      } catch (e) {
        err = e;
      }
      expect(err).not.toBeNull();
      expect(err.name).toBe('UnsafePathError');
      expect(err.reason).toBe('not_private');
      expect(fs.statSync(dir).mode & 0o777).toBe(0o755);
    } finally {
      await srv.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
