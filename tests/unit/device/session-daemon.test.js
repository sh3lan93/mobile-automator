'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { startDaemon, cleanStale } = require('../../../src/device/session-daemon');
const sessionClient = require('../../../src/device/session-client');
const paths = require('../../../src/device/session-paths');
const { ensureSalt, readSalt } = require('../../../src/device/session-salt');
const { ensureSessionDirs } = require('../../../src/device/session-dir');
const { UnsafePathError } = require('../../../src/workspace/safe-fs');
const { useSocketDeps } = require('../../helpers/socket-deps');

// A deep temp root's socket goes to the fallback directory: keep it in a
// temp dir of this file's, never the real per-user one (#346).
const socketDeps = useSocketDeps();

// Captured before any test fakes the clock, so a bounded wait still expires.
const realSetTimeout = setTimeout;
const realClearTimeout = clearTimeout;

// Reject instead of hanging: under fake timers, awaiting a promise that never
// settles hangs the whole jest run, not just the test — seen with an idle
// timer that never fires, even with afterEach cleanup in place.
function within(promise, ms, what) {
  let timer;
  const expiry = new Promise((_, reject) => {
    timer = realSetTimeout(() => reject(new Error(`${what} within ${ms}ms`)), ms);
  });
  return Promise.race([promise, expiry]).finally(() => realClearTimeout(timer));
}

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-daemon-'));
}

// Fake createCall: records how many times it builds a connection (must be 1)
// and how many tool calls each connection serves.
function makeFakeCreateCall() {
  const state = { builds: 0, calls: [], closed: 0 };
  const createCall = async ({ device } = {}) => {
    state.builds += 1;
    state.device = device || null;
    return {
      call: async (tool, args) => {
        state.calls.push({ tool, args });
        return { echoed: tool, args };
      },
      close: async () => {
        state.closed += 1;
      },
    };
  };
  return { createCall, state };
}

describe('session-daemon', () => {
  test('serves a request via the fake connection', async () => {
    const root = tmpRoot();
    const { createCall, state } = makeFakeCreateCall();
    const daemon = await startDaemon({ socketDeps: socketDeps(), root, projectRoot: root, idleMs: 0, createCall });

    const conn = await sessionClient.tryConnect(root, socketDeps());
    const res = await conn.call('mobile_press_button', { button: 'BACK' });
    expect(res).toEqual({ echoed: 'mobile_press_button', args: { button: 'BACK' } });
    expect(state.calls).toHaveLength(1);

    await conn.close();
    await daemon.stop();
  });

  test('single-connection invariant: N calls across M clients build exactly one connection', async () => {
    const root = tmpRoot();
    const { createCall, state } = makeFakeCreateCall();
    const daemon = await startDaemon({ socketDeps: socketDeps(), projectRoot: root, idleMs: 0, createCall });

    for (let i = 0; i < 5; i++) {
      const conn = await sessionClient.tryConnect(root, socketDeps());
      await conn.call('mobile_list_elements_on_screen', {});
      await conn.close();
    }

    expect(state.builds).toBe(1);
    expect(state.calls).toHaveLength(5);

    await daemon.stop();
  });

  // #251: the engine is recorded in the handle exactly like the device pin, so
  // a verb resolving a different engine can tell the live daemon is stale.
  test('passes engine to createCall and records engine + engine_source in the handle', async () => {
    const root = tmpRoot();
    let seen = null;
    const createCall = async (opts) => {
      seen = opts;
      return { call: async () => ({}), close: async () => {} };
    };
    const daemon = await startDaemon({ socketDeps: socketDeps(),
      projectRoot: root,
      engine: 'legacy',
      engineSource: 'config',
      idleMs: 0,
      createCall,
    });
    expect(seen.engine).toBe('legacy');
    // #236: the engine runs from the root so its argv can be root-relative.
    expect(seen.projectRoot).toBe(root);
    const handle = JSON.parse(fs.readFileSync(paths.handlePath(root), 'utf8'));
    expect(handle.engine).toBe('legacy');
    expect(handle.engine_source).toBe('config');
    await daemon.stop();
  });

  test('writes handle + pidfile on listen and removes them on stop', async () => {
    const root = tmpRoot();
    const { createCall } = makeFakeCreateCall();
    const daemon = await startDaemon({ socketDeps: socketDeps(), projectRoot: root, device: 'emulator-5554', idleMs: 0, createCall });

    expect(fs.existsSync(paths.handlePath(root))).toBe(true);
    expect(fs.existsSync(paths.pidFilePath(root))).toBe(true);
    const handle = JSON.parse(fs.readFileSync(paths.handlePath(root), 'utf8'));
    expect(handle.device).toBe('emulator-5554');
    expect(handle.pid).toBe(process.pid);
    // No engine given: the default robot, source unknown to the daemon.
    expect(handle.engine).toBe('mobilecli');
    expect(handle.engine_source).toBeNull();

    await daemon.stop();
    expect(fs.existsSync(paths.handlePath(root))).toBe(false);
    expect(fs.existsSync(paths.pidFilePath(root))).toBe(false);
    expect(fs.existsSync(paths.socketPath(root, socketDeps()))).toBe(false);
  });

  test('stop never deletes the marker salt: it is created once, never rotated (#236)', async () => {
    const root = tmpRoot();
    const salt = ensureSalt(root);
    const { createCall } = makeFakeCreateCall();
    const daemon = await startDaemon({ socketDeps: socketDeps(), projectRoot: root, idleMs: 0, createCall });
    await daemon.stop();
    expect(readSalt(root)).toBe(salt);
  });

  test('idle timeout reaps the daemon', async () => {
    const root = tmpRoot();
    const { createCall, state } = makeFakeCreateCall();
    const daemon = await startDaemon({ socketDeps: socketDeps(), projectRoot: root, idleMs: 50, createCall });

    await daemon.whenStopped;
    expect(state.closed).toBe(1);
    expect(fs.existsSync(paths.socketPath(root, socketDeps()))).toBe(false);
  });

  // Fake clock, not real sleeps: with real time, any event-loop stall longer
  // than the gap between idleMs and the ping interval (GC, a loaded jest
  // worker) let the timer fire mid-test and fail it as "session daemon
  // connection closed". Socket I/O is not a timer, so it still runs for real.
  describe('idle timer (fake clock)', () => {
    let daemon = null;

    beforeEach(() => jest.useFakeTimers());
    // afterEach runs even when the test throws or times out, so the fake clock
    // can never leak into later tests — stop() awaits a real setTimeout and
    // would hang every one of them. Real timers first, for the same reason.
    afterEach(async () => {
      jest.useRealTimers();
      if (daemon) await daemon.stop();
      daemon = null;
    });

    test('idle timer resets on each request', async () => {
      const root = tmpRoot();
      const { createCall, state } = makeFakeCreateCall();
      const idleMs = 1000;
      daemon = await startDaemon({ socketDeps: socketDeps(), projectRoot: root, idleMs, createCall });

      // Three pings, each just inside the idle window, keep it alive well past
      // the original one — only possible if every request re-arms the timer.
      for (let i = 0; i < 3; i++) {
        await jest.advanceTimersByTimeAsync(idleMs - 1);
        const conn = await sessionClient.tryConnect(root, socketDeps());
        await conn.call('ping_tool', {});
        await conn.close();
      }
      expect(await sessionClient.isAlive(root, socketDeps())).toBe(true);

      // And the timer is still armed: it reaps exactly idleMs after the last
      // request, so a daemon that never idles cannot pass this test.
      await jest.advanceTimersByTimeAsync(idleMs - 1);
      expect(state.closed).toBe(0);
      await jest.advanceTimersByTimeAsync(1);
      await within(daemon.whenStopped, 2000, 'expected the idle timer to reap the daemon');
      expect(state.closed).toBe(1);
    });
  });

  test('cleanStale removes a stale socket/pidfile so a fresh daemon can bind', async () => {
    const root = tmpRoot();
    ensureSessionDirs(root, socketDeps());
    // Write a pidfile pointing at a definitely-dead pid + a leftover socket file.
    fs.writeFileSync(paths.pidFilePath(root), '999999999\n');
    fs.writeFileSync(paths.socketPath(root, socketDeps()), 'stale');
    fs.writeFileSync(paths.handlePath(root), '{}');

    expect(() => cleanStale(root)).toThrow(/requires socketPath/);
    const r = cleanStale(root, { socketPath: paths.socketPath(root, socketDeps()) });
    expect(r.cleaned).toBe(true);
    expect(fs.existsSync(paths.socketPath(root, socketDeps()))).toBe(false);
    expect(fs.existsSync(paths.pidFilePath(root))).toBe(false);

    // And a fresh daemon binds cleanly afterwards.
    const { createCall } = makeFakeCreateCall();
    const daemon = await startDaemon({ socketDeps: socketDeps(), projectRoot: root, idleMs: 0, createCall });
    expect(await sessionClient.isAlive(root, socketDeps())).toBe(true);
    await daemon.stop();
  });

  test('startDaemon reaps its own stale leftovers before binding', async () => {
    const root = tmpRoot();
    ensureSessionDirs(root, socketDeps());
    fs.writeFileSync(paths.pidFilePath(root), '999999999\n');
    fs.writeFileSync(paths.socketPath(root, socketDeps()), 'stale');

    const { createCall } = makeFakeCreateCall();
    const daemon = await startDaemon({ socketDeps: socketDeps(), projectRoot: root, idleMs: 0, createCall });
    expect(await sessionClient.isAlive(root, socketDeps())).toBe(true);
    await daemon.stop();
  });

  test('shutdown control frame stops the daemon', async () => {
    const root = tmpRoot();
    const { createCall, state } = makeFakeCreateCall();
    const daemon = await startDaemon({ socketDeps: socketDeps(), projectRoot: root, idleMs: 0, createCall });

    const acked = await sessionClient.requestShutdown(root, socketDeps());
    expect(acked).toBe(true);
    await daemon.whenStopped;
    expect(state.closed).toBe(1);
    expect(fs.existsSync(paths.socketPath(root, socketDeps()))).toBe(false);
  });
});

// #346: the daemon's files are reachable by nobody else, and every one of them
// is written through safe-fs, so a planted link is replaced or refused, never
// written through.
describe('session-daemon private files (#346)', () => {
  const isRoot = process.getuid() === 0;
  const testNotRoot = isRoot ? test.skip : test;
  const mode = (p) => fs.lstatSync(p).mode & 0o777;

  function outsideDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-daemon-out-'));
  }

  // The isolation every daemon suite relies on (tests/helpers/socket-deps.js):
  // a root too deep for an in-workspace socket binds in the fallback under the
  // socketDeps it was given, never the real per-user directory, and the client
  // given the same deps finds it there. Deep on every host, so this is never
  // vacuously in the workspace.
  test('a deep root binds in the fallback under its socketDeps, and the client finds it there', async () => {
    const root = path.join(tmpRoot(), 'd'.repeat(80));
    fs.mkdirSync(root);
    const { createCall } = makeFakeCreateCall();
    const daemon = await startDaemon({ socketDeps: socketDeps(), projectRoot: root, idleMs: 0, createCall });
    try {
      const { file, inWorkspace } = paths.socketLocation(root, socketDeps());
      expect(inWorkspace).toBe(false);
      expect(file.startsWith(socketDeps().tmpdir() + path.sep)).toBe(true);
      expect(daemon.socketPath).toBe(file);
      expect(await sessionClient.isAlive(root, socketDeps())).toBe(true);
    } finally {
      await daemon.stop();
    }
  });

  // D-a: pidIdentity calls our own pid 'ours', so a daemon.pid or lock that
  // FOLLOWED a planted link to a file holding our pid would look like a live
  // daemon and wedge the start. Neither is followed, so the links are just
  // stale files: swept, then replaced by real ones.
  test('planted pid, handle and lock links holding our pid are swept as stale, never followed', async () => {
    const root = tmpRoot();
    const outside = outsideDir();
    const targets = {
      [paths.pidFilePath(root)]: path.join(outside, 'pid-target'),
      [paths.handlePath(root)]: path.join(outside, 'handle-target'),
      [paths.lockPath(root)]: path.join(outside, 'lock-target'),
    };
    fs.mkdirSync(paths.sessionDir(root), { recursive: true });
    for (const [link, target] of Object.entries(targets)) {
      fs.writeFileSync(target, `${process.pid}\n`);
      fs.symlinkSync(target, link);
    }

    const { createCall } = makeFakeCreateCall();
    const daemon = await startDaemon({ socketDeps: socketDeps(), projectRoot: root, idleMs: 0, createCall });
    try {
      for (const target of Object.values(targets)) {
        expect(fs.readFileSync(target, 'utf8')).toBe(`${process.pid}\n`);
      }
      expect(fs.readdirSync(outside).sort()).toEqual(['handle-target', 'lock-target', 'pid-target']);
      for (const link of Object.keys(targets)) {
        const st = fs.lstatSync(link);
        expect(st.isSymbolicLink()).toBe(false);
        expect(st.isFile()).toBe(true);
      }
      expect(JSON.parse(fs.readFileSync(paths.handlePath(root), 'utf8')).session_id).toBe(daemon.sessionId);
      expect(fs.readFileSync(paths.pidFilePath(root), 'utf8')).toBe(`${process.pid}\n`);
      expect(fs.readFileSync(paths.lockPath(root), 'utf8')).toBe(`${process.pid}\n`);
    } finally {
      await daemon.stop();
    }
  });

  // A link planted after the stale sweep (here, while the engine connects) is
  // the one a plain write would follow. The rename replaces it instead.
  test('handle and pid links planted after the stale sweep are replaced, never written through', async () => {
    const root = tmpRoot();
    const outside = outsideDir();
    const targets = {
      [paths.handlePath(root)]: path.join(outside, 'handle-target'),
      [paths.pidFilePath(root)]: path.join(outside, 'pid-target'),
    };
    const createCall = async () => {
      for (const [link, target] of Object.entries(targets)) {
        fs.writeFileSync(target, 'precious\n');
        fs.symlinkSync(target, link);
      }
      return { call: async () => ({}), close: async () => {} };
    };
    const daemon = await startDaemon({ socketDeps: socketDeps(), projectRoot: root, idleMs: 0, createCall });
    try {
      for (const [link, target] of Object.entries(targets)) {
        expect(fs.readFileSync(target, 'utf8')).toBe('precious\n');
        expect(fs.lstatSync(link).isFile()).toBe(true);
      }
      expect(JSON.parse(fs.readFileSync(paths.handlePath(root), 'utf8')).pid).toBe(process.pid);
    } finally {
      await daemon.stop();
    }
  });

  testNotRoot('under umask 022, .session is 0700, the socket and lock 0600; the umask is restored', async () => {
    const root = tmpRoot();
    const prev = process.umask(0o022);
    let daemon;
    try {
      const { createCall } = makeFakeCreateCall();
      daemon = await startDaemon({ socketDeps: socketDeps(), projectRoot: root, idleMs: 0, createCall });
      expect(process.umask(0o022)).toBe(0o022);
      expect(mode(paths.sessionDir(root))).toBe(0o700);
      expect(fs.lstatSync(daemon.socketPath).isSocket()).toBe(true);
      expect(mode(daemon.socketPath)).toBe(0o600);
      expect(mode(paths.lockPath(root))).toBe(0o600);
    } finally {
      process.umask(prev);
      if (daemon) await daemon.stop();
    }
  });

  test('a socket that cannot be made 0600 fails the start like a listen failure, undoing it', async () => {
    const root = tmpRoot();
    const sock = paths.socketPath(root, socketDeps());
    const realChmod = fs.chmodSync;
    const chmod = jest.spyOn(fs, 'chmodSync').mockImplementation((p, m) => {
      if (p === sock) throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
      return realChmod(p, m);
    });
    const { createCall, state } = makeFakeCreateCall();
    const events = [];
    try {
      await expect(
        startDaemon({ socketDeps: socketDeps(), projectRoot: root, idleMs: 0, createCall, recorderFor: () => (e) => events.push(e) })
      ).rejects.toMatchObject({ code: 'EPERM' });
    } finally {
      chmod.mockRestore();
    }
    expect(events.map((e) => e.event)).toContain('daemon.listen_failure');
    expect(state.closed).toBe(1);
    expect(fs.existsSync(sock)).toBe(false);
    expect(fs.existsSync(paths.lockPath(root))).toBe(false);
    expect(fs.existsSync(paths.handlePath(root))).toBe(false);
  });

  testNotRoot('a pre-existing 0755 .session (an older mauto) is 0700 after start', async () => {
    const root = tmpRoot();
    fs.mkdirSync(paths.sessionDir(root), { recursive: true });
    fs.chmodSync(paths.sessionDir(root), 0o755);
    const { createCall } = makeFakeCreateCall();
    const daemon = await startDaemon({ socketDeps: socketDeps(), projectRoot: root, idleMs: 0, createCall });
    try {
      expect(mode(paths.sessionDir(root))).toBe(0o700);
    } finally {
      await daemon.stop();
    }
  });

  test('a symlinked .session is refused before anything is built or created', async () => {
    const root = tmpRoot();
    const outside = outsideDir();
    fs.mkdirSync(path.join(root, '.mobile-automator'));
    fs.symlinkSync(outside, paths.sessionDir(root));
    const { createCall, state } = makeFakeCreateCall();
    const events = [];
    const start = startDaemon({ socketDeps: socketDeps(),
      projectRoot: root,
      idleMs: 0,
      createCall,
      recorderFor: () => (e) => events.push(e),
    });
    await expect(start).rejects.toBeInstanceOf(UnsafePathError);
    await expect(start).rejects.toMatchObject({ reason: 'symlink', path: paths.sessionDir(root) });
    expect(fs.readdirSync(outside)).toEqual([]);
    expect(state.builds).toBe(0);
    expect(events.map((e) => e.event)).toContain('daemon.start_failure');
  });

  test('a lock-race loser is told how to clear a stuck lock', async () => {
    const root = tmpRoot();
    const { createCall } = makeFakeCreateCall();
    const winner = await startDaemon({ socketDeps: socketDeps(), projectRoot: root, idleMs: 0, createCall });
    try {
      const loser = startDaemon({ socketDeps: socketDeps(), projectRoot: root, idleMs: 0, createCall: makeFakeCreateCall().createCall });
      await expect(loser).rejects.toMatchObject({ code: 'ELOCKED' });
      await expect(loser).rejects.toThrow(/lock held.*if none is starting, run `mauto session end`/);
    } finally {
      await winner.stop();
    }
  });
});

// The daemon's half of the client's handshake (#361): it proves it holds the
// workspace's session secret by answering a client nonce with
// sessionProof(salt, root, nonce).
describe('session-daemon hello (#361)', () => {
  const net = require('net');
  const { FrameParser } = require('../../../src/device/session-protocol');

  // Send raw frames over one connection, resolve the replies in order.
  function exchange(sockPath, frames) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(sockPath);
      const parser = new FrameParser();
      const replies = [];
      socket.setEncoding('utf8');
      socket.on('error', reject);
      socket.on('connect', () => {
        for (const f of frames) socket.write(FrameParser.encode(f));
      });
      socket.on('data', (chunk) => {
        for (const f of parser.push(chunk)) replies.push(f.value);
        if (replies.length === frames.length) {
          socket.end();
          resolve(replies);
        }
      });
    });
  }

  function start(root, extra = {}) {
    return startDaemon({ socketDeps: socketDeps(), projectRoot: root, idleMs: 0, createCall: makeFakeCreateCall().createCall, ...extra });
  }

  test('daemon start ensures the workspace salt', async () => {
    const root = tmpRoot();
    expect(readSalt(root)).toBeNull();
    const daemon = await start(root);
    try {
      expect(readSalt(root)).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await daemon.stop();
    }
  });

  test('hello is answered with the proof for this workspace and the nonce', async () => {
    const root = tmpRoot();
    const daemon = await start(root);
    try {
      const salt = readSalt(root);
      const [a, b] = await exchange(daemon.socketPath, [
        { id: 1, type: 'hello', nonce: 'abc' },
        { id: 2, type: 'hello', nonce: 'def' },
      ]);
      expect(a).toEqual({ id: 1, ok: true, result: { proof: paths.sessionProof(salt, root, 'abc') } });
      expect(b).toEqual({ id: 2, ok: true, result: { proof: paths.sessionProof(salt, root, 'def') } });
    } finally {
      await daemon.stop();
    }
  });

  test('a missing, non-string, empty or oversized nonce is rejected', async () => {
    const root = tmpRoot();
    const daemon = await start(root);
    try {
      const replies = await exchange(daemon.socketPath, [
        { id: 1, type: 'hello' },
        { id: 2, type: 'hello', nonce: 42 },
        { id: 3, type: 'hello', nonce: '' },
        { id: 4, type: 'hello', nonce: 'x'.repeat(257) },
      ]);
      for (const [i, r] of replies.entries()) {
        expect(r).toMatchObject({ id: i + 1, ok: false, error: { message: expect.stringMatching(/nonce/) } });
        expect(r.result).toBeUndefined();
      }
    } finally {
      await daemon.stop();
    }
  });

  test('a salt that cannot be read or created fails the start as daemon.start_failure', async () => {
    const root = tmpRoot();
    fs.mkdirSync(paths.sessionDir(root), { recursive: true, mode: 0o700 });
    fs.writeFileSync(paths.saltPath(root), '\n'); // empty: ensureSalt never replaces it
    const events = [];
    const starting = start(root, { recorderFor: () => (e) => events.push(e) });
    await expect(starting).rejects.toThrow(/salt/);
    expect(events.map((e) => e.event)).toContain('daemon.start_failure');
  });
});
