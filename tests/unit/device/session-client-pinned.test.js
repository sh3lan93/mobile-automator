'use strict';

// The session client talks only to this workspace's daemon (#361). Two
// guards, each pinned here on all four client entry points:
//   - it connects through the very directory it checked, even when that
//     directory is renamed away and another put in its place right after the
//     check (a group-writable .mobile-automator/ allows that);
//   - the peer must answer a hello with sessionProof(salt, root, nonce), the
//     salt read from that same checked directory, before anything else is
//     sent.
// And the pin itself: the working-directory window is synchronous, so no
// queued job ever runs inside it, and a failed restore is thrown.
//
// Real sockets and real renames. Another user is simulated: by a foreign uid
// reported for the attacker's inodes (an injected fs), or by a 0755 attacker
// directory, which the same check refuses. Nothing touches the real per-user
// fallback directory.

const childProcess = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const { startDaemon } = require('../../../src/device/session-daemon');
const { tryConnect, isAlive, requestShutdown, getSessionStatus } = require('../../../src/device/session-client');
const paths = require('../../../src/device/session-paths');
const { ensureSessionDirs } = require('../../../src/device/session-dir');
const { ensureSalt } = require('../../../src/device/session-salt');
const { FrameParser, sessionProof } = require('../../../src/device/session-protocol');
const { useSocketDeps } = require('../../helpers/socket-deps');

const socketDeps = useSocketDeps();

const REAL_UID = process.getuid();
const FOREIGN_UID = REAL_UID + 1;
const maybe = REAL_UID === 0 ? test.skip : test;
// How long the rename race runs.
const RACE_MS = 2000;
const DOWN = { running: false, reason: null, in_flight: null, device: null };

let cleanups;
beforeEach(() => {
  cleanups = [];
});
afterEach(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

// A root whose in-workspace socket fits the sockaddr limit: /tmp, not macOS's
// long os.tmpdir().
function shortRoot() {
  const root = fs.mkdtempSync(path.join('/tmp', 'mp-'));
  expect(paths.socketLocation(root, socketDeps()).inWorkspace).toBe(true);
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

async function liveDaemon(root) {
  const daemon = await startDaemon({
    socketDeps: socketDeps(),
    projectRoot: root,
    idleMs: 0,
    createCall: async () => ({ call: async (tool) => ({ tool }), close: async () => {} }),
  });
  cleanups.push(() => daemon.stop());
  return daemon;
}

// A listener speaking the protocol, recording every frame type it receives.
// `onHello(frame)` returns the hello reply (or null to answer like a daemon
// that predates the handshake); every other frame is answered ok.
function fakePeer(sockPath, onHello) {
  const state = { connections: 0, types: [] };
  const server = net.createServer((socket) => {
    state.connections += 1;
    const parser = new FrameParser();
    socket.setEncoding('utf8');
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      for (const f of parser.push(chunk)) {
        if (!f.value) continue;
        const req = f.value;
        state.types.push(req.type);
        if (req.type === 'hello') {
          const reply = onHello(req);
          socket.write(
            FrameParser.encode(reply || { id: req.id, ok: false, error: { message: `unknown request type: ${req.type}` } })
          );
        } else {
          socket.write(FrameParser.encode({ id: req.id, ok: true, result: { pong: true, stopping: true } }));
        }
      }
    });
  });
  cleanups.push(() => new Promise((resolve) => server.close(() => resolve())));
  return new Promise((resolve) => server.listen(sockPath, () => resolve(state)));
}

const proofReply = (salt, root) => (req) => ({
  id: req.id,
  ok: true,
  result: { proof: sessionProof(salt, root, req.nonce) },
});

// An attacker directory beside .session/: its own salt and a listener that
// answers hello correctly for ITS salt, so only a client that proves against
// the salt of the directory it checked turns it away.
async function attackerDir(root, { mode = 0o700 } = {}) {
  const dir = path.join(paths.sessionDir(root) + '-atk');
  fs.mkdirSync(dir, { mode: 0o700 });
  const salt = 'f'.repeat(64);
  fs.writeFileSync(path.join(dir, paths.SALT_NAME), `${salt}\n`, { mode: 0o600 });
  const peer = await fakePeer(path.join(dir, paths.SOCKET_NAME), proofReply(salt, root));
  fs.chmodSync(dir, mode);
  return { dir, salt, peer };
}

// An fs that, the first time the socket's lstat is asked for (by either
// spelling, absolute or relative), answers it truthfully and THEN swaps the
// attacker's directory into .session/'s place: the moment right after the
// check. With `at: 'pin'` the swap follows the pinned check of '.' instead:
// right after the client entered the directory, before it reads anything.
// With `hold`, the swap stays until the test calls state.restore(), so it
// also covers whatever the client does after it connected. The swap is undone on the next turn of the event loop, so it covers
// everything a client does synchronously after its check. With `foreign`, the
// attacker's inodes report another uid, as another user's would.
function swappingFs(root, atk, { foreign = true, at = 'socket', hold = false } = {}) {
  const session = paths.sessionDir(root);
  const parked = `${session}-parked`;
  const atkInodes = new Set();
  const collect = (p) => {
    atkInodes.add(fs.lstatSync(p).ino);
    if (fs.lstatSync(p).isDirectory()) for (const e of fs.readdirSync(p)) collect(path.join(p, e));
  };
  collect(atk);
  const state = { swaps: 0 };
  const disguise = (st) => {
    if (foreign && atkInodes.has(st.ino)) st.uid = FOREIGN_UID;
    return st;
  };
  const wrapped = {
    ...fs,
    lstatSync: (p, ...rest) => {
      const st = disguise(fs.lstatSync(p, ...rest));
      const trigger = at === 'pin' ? p === '.' : path.basename(String(p)) === paths.SOCKET_NAME;
      if (trigger && !state.armed) {
        state.armed = true;
        fs.renameSync(session, parked);
        fs.renameSync(atk, session);
        state.swaps += 1;
        state.restore = () => {
          fs.renameSync(session, atk);
          fs.renameSync(parked, session);
          state.armed = false;
        };
        if (!hold) setImmediate(state.restore);
      }
      return st;
    },
    fstatSync: (fd, ...rest) => disguise(fs.fstatSync(fd, ...rest)),
  };
  return { fs: wrapped, state };
}

// Settle any swap still pending before the next step reads the tree.
const tick = () => new Promise((resolve) => setImmediate(() => setImmediate(resolve)));

describe('the client connects through the directory it checked (#361)', () => {
  maybe('a .session/ swapped right after the check is never connected to, on any entry point', async () => {
    const root = shortRoot();
    await liveDaemon(root);
    const atk = await attackerDir(root);
    const { fs: swapFs, state } = swappingFs(root, atk.dir);
    const deps = { ...socketDeps(), fs: swapFs };

    const conn = await tryConnect(root, deps);
    await tick();
    expect(conn).not.toBeNull();
    expect(await conn.call('mobile_list_apps', {})).toEqual({ tool: 'mobile_list_apps' });
    await conn.close();

    expect(await isAlive(root, deps)).toBe(true);
    await tick();
    expect(await getSessionStatus(root, deps)).toMatchObject({ running: true });
    await tick();
    expect(await requestShutdown(root, deps)).toBe(true);
    await tick();

    expect(state.swaps).toBe(4);
    expect(atk.peer.connections).toBe(0);
  });

  // The salt the proof is checked against comes from the pinned directory
  // too. The swap here lands right after the client entered .session/, so a
  // salt looked up by name at any point after that would be the attacker's,
  // the genuine daemon's proof would not match it, and the client would turn
  // the real daemon away.
  maybe('the proof is checked against the salt of the checked directory, not one read by name later', async () => {
    const root = shortRoot();
    await liveDaemon(root);
    const atk = await attackerDir(root);
    const { fs: swapFs, state } = swappingFs(root, atk.dir, { foreign: false, at: 'pin', hold: true });
    const deps = { ...socketDeps(), fs: swapFs };

    const conn = await tryConnect(root, deps);
    state.restore();
    expect(conn).not.toBeNull();
    await conn.close();
    const alive = await isAlive(root, deps);
    state.restore();
    expect(alive).toBe(true);
    expect(state.swaps).toBe(2);
    expect(atk.peer.types.filter((t) => t !== 'hello')).toEqual([]);
  });

  // A real race: another process keeps swapping .session/ with an attacker
  // directory while the client connects. The attacker's directory is 0755, so
  // the check refuses it wherever the client meets it, as it would refuse
  // another user's. Each connect either reaches the real daemon or reads as
  // no daemon; the attacker never receives a frame but a hello.
  maybe('a concurrent rename loop never delivers a frame other than hello to the attacker', async () => {
    const root = shortRoot();
    await liveDaemon(root);
    const atk = await attackerDir(root, { mode: 0o755 });
    const session = paths.sessionDir(root);
    const script = `
      const fs = require('fs');
      const [s, a, p] = process.argv.slice(1);
      const end = Date.now() + 10000;
      fs.writeSync(1, 'go');
      while (Date.now() < end) {
        try { fs.renameSync(s, p); fs.renameSync(a, s); fs.renameSync(s, a); fs.renameSync(p, s); } catch (_) {}
      }`;
    const child = childProcess.spawn(process.execPath, ['-e', script, session, atk.dir, `${session}-p`], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const exited = new Promise((resolve) => child.once('exit', resolve));
    // Connect only once the loop is running.
    const started = await Promise.race([
      new Promise((resolve) => child.stdout.once('data', () => resolve(true))),
      exited.then(() => false),
    ]);
    expect(started).toBe(true);
    // The window a by-path connect leaves is microseconds wide, so connect
    // for a fixed time (hundreds of attempts) rather than a fixed count.
    let attempts = 0;
    try {
      const until = Date.now() + RACE_MS;
      while (Date.now() < until || attempts < 50) {
        await isAlive(root, socketDeps());
        attempts += 1;
      }
    } finally {
      child.kill('SIGTERM');
      await exited;
    }
    // Put the tree back however the loop left it: the genuine directory is
    // either at .session/ already or parked.
    if (fs.existsSync(`${session}-p`)) {
      if (fs.existsSync(session)) fs.renameSync(session, atk.dir);
      fs.renameSync(`${session}-p`, session);
    }
    expect(atk.peer.types.filter((t) => t !== 'hello')).toEqual([]);
    expect(attempts).toBeGreaterThanOrEqual(50);
  }, 15000);
});

describe('the peer must prove it holds the workspace secret (#361)', () => {
  async function drive(root) {
    const conn = await tryConnect(root, socketDeps());
    if (conn) await conn.close();
    return {
      conn,
      alive: await isAlive(root, socketDeps()),
      status: await getSessionStatus(root, socketDeps()),
      shutdown: await requestShutdown(root, socketDeps()),
    };
  }

  async function privateWorkspaceWith(onHello) {
    const root = shortRoot();
    ensureSessionDirs(root, socketDeps());
    const salt = ensureSalt(root);
    const peer = await fakePeer(paths.socketPath(root, socketDeps()), onHello(salt, root));
    return { root, peer };
  }

  test.each([
    ['answers ping but not hello (a daemon older than the handshake)', () => () => null],
    ['answers hello with a wrong proof', () => (req) => ({ id: req.id, ok: true, result: { proof: '0'.repeat(64) } })],
    ['answers hello with no proof', () => (req) => ({ id: req.id, ok: true, result: {} })],
    ['has the salt but serves another root (a copied workspace)', (salt) => proofReply(salt, '/elsewhere/copy')],
  ])('a peer that %s reads as no daemon, and receives only hellos', async (_name, makeOnHello) => {
    const { root, peer } = await privateWorkspaceWith((salt, r) => makeOnHello(salt, r));
    const r = await drive(root);
    expect(r).toEqual({ conn: null, alive: false, status: DOWN, shutdown: false });
    expect(peer.connections).toBe(4);
    expect(peer.types).toEqual(['hello', 'hello', 'hello', 'hello']);
  });

  test('a peer with the right proof is the daemon', async () => {
    const { root, peer } = await privateWorkspaceWith((salt, r) => proofReply(salt, r));
    expect(await isAlive(root, socketDeps())).toBe(true);
    expect(peer.types).toEqual(['hello', 'ping']);
  });
});

describe('the working-directory pin is a synchronous window (#361)', () => {
  // Every job queued while the process is inside the pinned directory must
  // see the original working directory: none may run inside the window.
  function watchChdir() {
    const before = process.cwd();
    const realChdir = process.chdir;
    const seen = [];
    const calls = [];
    const spy = jest.spyOn(process, 'chdir').mockImplementation((d) => {
      realChdir.call(process, d);
      calls.push(d);
      if (process.cwd() !== before) {
        queueMicrotask(() => seen.push(process.cwd()));
        Promise.resolve().then(() => seen.push(process.cwd()));
        setImmediate(() => seen.push(process.cwd()));
      }
    });
    cleanups.push(() => spy.mockRestore());
    return { before, seen, calls };
  }

  maybe('no queued job runs inside the window, on success, refusal or a failed check', async () => {
    const root = shortRoot();
    await liveDaemon(root);
    const w = watchChdir();
    // '.' is the one path only the pinned check lstats: make it foreign.
    const foreignDot = {
      ...fs,
      lstatSync: (p, ...rest) => {
        const st = fs.lstatSync(p, ...rest);
        if (p === '.') st.uid = FOREIGN_UID;
        return st;
      },
    };
    const refusing = { ...socketDeps(), fs: foreignDot };

    const conn = await tryConnect(root, socketDeps());
    expect(conn).not.toBeNull();
    await conn.close();
    expect(await tryConnect(root, refusing)).toBeNull();
    expect(await isAlive(root, socketDeps())).toBe(true);
    expect(await isAlive(root, refusing)).toBe(false);
    expect(await getSessionStatus(root, socketDeps())).toMatchObject({ running: true });
    expect(await getSessionStatus(root, refusing)).toEqual(DOWN);
    expect(await requestShutdown(root, refusing)).toBe(false);
    expect(await requestShutdown(root, socketDeps())).toBe(true);
    await tick();

    expect(w.calls.length).toBeGreaterThanOrEqual(16);
    expect(w.calls.length % 2).toBe(0); // every entry balanced by a restore
    expect(w.seen.length).toBe(w.calls.length / 2 * 3);
    expect(new Set(w.seen)).toEqual(new Set([w.before]));
    expect(process.cwd()).toBe(w.before);
  });

  test('a failed restore of the working directory rejects the entry point', async () => {
    const root = shortRoot();
    ensureSessionDirs(root, socketDeps());
    ensureSalt(root);
    const before = process.cwd();
    const realChdir = process.chdir;
    let n = 0;
    const spy = jest.spyOn(process, 'chdir').mockImplementation((d) => {
      n += 1;
      if (n === 2) throw Object.assign(new Error('restore failed'), { code: 'ENOENT' });
      return realChdir.call(process, d);
    });
    try {
      await expect(tryConnect(root, socketDeps())).rejects.toThrow('restore failed');
    } finally {
      spy.mockRestore();
      process.chdir(before);
    }
  });
});
