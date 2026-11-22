'use strict';

// The socket path is decided once per side and then used as is (#346 review
// round 3). The client uses exactly the connection connectPinned opened
// through the directory it checked (#361), and the salt it read there; the
// daemon binds, sweeps, unlinks and records exactly the path
// ensureSessionDirs prepared. Neither recomputes it, so a check and the use it
// guards can never name two different paths.
//
// To prove that, session-dir is mocked to answer with a path (and, for the
// client, a connection and salt) that a recomputation would never produce: a
// socket in a directory of this test's own, a salt in no file. Only code that
// uses the answer it was given reaches it. Real sockets,
// real files; nothing touches the real per-user fallback directory.

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

let base;
let elsewhere;
let servers;

beforeEach(() => {
  // Short: the socket path must fit the sockaddr limit.
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'ssp-'));
  elsewhere = path.join(base, 'elsewhere.sock');
  servers = [];
});

afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((resolve) => s.close(() => resolve()))));
  jest.resetModules();
  fs.rmSync(base, { recursive: true, force: true });
});

// Load the client and daemon against a session-dir whose two answers are
// `elsewhere`. The directory side of ensureSessionDirs still runs for real
// (.session/ is made), only its answer is replaced.
function loadWithSocketAt(socketPath) {
  let mods;
  jest.isolateModules(() => {
    jest.doMock('../../../src/device/session-dir', () => {
      const actual = jest.requireActual('../../../src/device/session-dir');
      return {
        ...actual,
        connectPinned: () => ({ socket: net.createConnection(socketPath), salt: PINNED_SALT }),
        ensureSessionDirs: (root, deps) => {
          actual.ensureSessionDir(root, deps);
          return socketPath;
        },
      };
    });
    mods = {
      client: require('../../../src/device/session-client'),
      daemon: require('../../../src/device/session-daemon'),
      paths: require('../../../src/device/session-paths'),
    };
  });
  return mods;
}

// A salt no file holds: only a client that proves against the salt
// connectPinned handed it accepts the listener below.
const PINNED_SALT = 'pinned-salt-from-the-checked-directory';

// Answers hello with the proof for PINNED_SALT, then closes.
function listen(sock, root) {
  const { FrameParser } = require('../../../src/device/session-protocol');
  const { sessionProof } = require('../../../src/device/session-paths');
  const server = net.createServer((c) => {
    const parser = new FrameParser();
    c.setEncoding('utf8');
    c.on('error', () => {});
    c.on('data', (chunk) => {
      for (const f of parser.push(chunk)) {
        if (f.value && f.value.type === 'hello' && root) {
          c.write(FrameParser.encode({ id: f.value.id, ok: true, result: { proof: sessionProof(PINNED_SALT, root, f.value.nonce) } }));
        } else c.end();
      }
    });
  });
  servers.push(server);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(sock, () => resolve(server));
  });
}

test('the client uses the connection and salt connectPinned returned, nothing else', async () => {
  const root = path.join(base, 'p');
  await listen(elsewhere, root);
  const { client } = loadWithSocketAt(elsewhere);
  const conn = await client.tryConnect(root);
  expect(conn).not.toBeNull();
  await conn.close();
});

test('the daemon binds, records and unlinks the path ensureSessionDirs returned', async () => {
  const { daemon: mod, paths } = loadWithSocketAt(elsewhere);
  const root = path.join(base, 'p');
  fs.mkdirSync(root);
  const createCall = async () => ({ call: async () => ({}), close: async () => {} });

  const daemon = await mod.startDaemon({ projectRoot: root, idleMs: 0, createCall });
  try {
    expect(daemon.socketPath).toBe(elsewhere);
    expect(fs.lstatSync(elsewhere).isSocket()).toBe(true);
    expect(JSON.parse(fs.readFileSync(paths.handlePath(root), 'utf8')).socket).toBe(elsewhere);
  } finally {
    await daemon.stop();
  }
  expect(fs.existsSync(elsewhere)).toBe(false);
});

// server.close() already removes the socket it listened on, so "the bound path
// is gone after stop" cannot tell the unlinks apart. A file planted where a
// recomputation would point can: stop must leave it alone.
test('stop never unlinks a recomputed path', async () => {
  const { daemon: mod, paths } = loadWithSocketAt(elsewhere);
  const root = base;
  const recomputed = paths.socketLocation(root);
  expect(recomputed.inWorkspace).toBe(true); // stays inside this test's dir
  const createCall = async () => ({ call: async () => ({}), close: async () => {} });

  const daemon = await mod.startDaemon({ projectRoot: root, idleMs: 0, createCall });
  fs.writeFileSync(recomputed.file, 'not this daemon');
  await daemon.stop();
  expect(fs.readFileSync(recomputed.file, 'utf8')).toBe('not this daemon');
});

test('a stale file at that path is swept before the bind', async () => {
  const { daemon: mod } = loadWithSocketAt(elsewhere);
  const root = path.join(base, 'p');
  fs.mkdirSync(root);
  fs.writeFileSync(elsewhere, 'stale');
  const createCall = async () => ({ call: async () => ({}), close: async () => {} });

  const daemon = await mod.startDaemon({ projectRoot: root, idleMs: 0, createCall });
  try {
    expect(fs.lstatSync(elsewhere).isSocket()).toBe(true);
  } finally {
    await daemon.stop();
  }
});
