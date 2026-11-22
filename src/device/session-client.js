'use strict';

// Client side of the device session daemon protocol.
//
// tryConnect(projectRoot) returns a { call, close } pair shaped EXACTLY like
// mobile-mcp-client.createCall, so a daemon-backed bridge is a drop-in for a
// one-shot bridge. Returns null when no live daemon is reachable (the caller
// then falls back to a one-shot spawn). Requests are correlated by id so a
// single connection can multiplex concurrent calls.
//
// The client never talks to a peer it cannot vouch for (#346, #361). The
// daemon answers any peer that reaches its socket, and every call can drive
// the device, so the client must know the peer is this workspace's daemon
// before it sends anything that matters. Two guards, both required:
//   - connectPinned (session-dir.js) checks that the socket's directory is
//     private (0700, ours, no links on the way) and the socket a real socket
//     of ours, and then connects through that very directory, never through a
//     path that could name another directory by the time it is used;
//   - the first frame on every connection is a hello: the peer must answer
//     the client's fresh nonce with sessionProof(salt, root, nonce), keyed by
//     the workspace secret (.session/marker.salt) read from the same checked
//     directory. Nothing else is sent until it does.
// Any failure (no socket, a refused directory, no salt, a wrong or missing
// proof, a timeout, a daemon too old to know hello) reads as "no daemon here":
// the verb starts its own or runs one-shot, and the peer received only a
// nonce.

const crypto = require('crypto');
const net = require('net');

const { connectPinned } = require('./session-dir');
const { sessionProof } = require('./session-paths');
const { FrameParser } = require('./session-protocol');

const DEFAULT_TIMEOUT_MS = 30000;
const HELLO_TIMEOUT_MS = 2000;

// Resolve `socket` once connected, or null if it fails to connect.
function awaitConnect(socket) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    socket.once('connect', () => done(socket));
    socket.once('error', () => done(null));
  });
}

// Does the peer's proof equal the expected one? Constant-time, and false for
// anything that is not a string of the same length.
function proofMatches(got, want) {
  if (typeof got !== 'string') return false;
  const a = Buffer.from(got, 'utf8');
  const b = Buffer.from(want, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// The ONE place the client opens a connection: connectPinned's, through the
// directory it checked, and then the hello. Resolves the wrapped client once
// the peer has proven it holds this workspace's salt, or null (with the
// connection closed) for anything less. Rejects only when connectPinned could
// not restore the working directory.
//
// `socketDeps` ({ tmpdir, getuid }) is where the socket fallback is looked
// for, reaching connectPinned unchanged; every entry point below takes it as
// its second argument. Production passes none. Tests pass the same value they
// gave startDaemon, so both sides agree without touching the process.
async function connectVerified(projectRoot, socketDeps = {}) {
  // net.createConnection on a Unix socket does its connect(2) before it
  // returns, inside connectPinned's pinned window.
  const pinned = connectPinned(projectRoot, (name) => net.createConnection(name), socketDeps);
  if (!pinned) return null;
  const socket = await awaitConnect(pinned.socket);
  if (!socket) return null;
  const client = wrapSocket(socket);
  const nonce = crypto.randomBytes(32).toString('hex');
  try {
    const res = await client.request({ type: 'hello', nonce }, { timeoutMs: HELLO_TIMEOUT_MS });
    const proof = res && res.ok && res.result ? res.result.proof : null;
    if (proofMatches(proof, sessionProof(pinned.salt, projectRoot, nonce))) return client;
  } catch (_) {
    // timed out or the connection dropped: not a daemon we can vouch for
  }
  await client.close();
  return null;
}

// Build a { call, close, request } client over an already-connected socket.
function wrapSocket(socket) {
  const parser = new FrameParser();
  const pending = new Map();
  let nextId = 1;
  let closed = false;

  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    for (const f of parser.push(chunk)) {
      if (f.error) continue; // ignore malformed responses
      const res = f.value;
      const entry = pending.get(res.id);
      if (entry) {
        pending.delete(res.id);
        entry.resolve(res);
      }
    }
  });

  const failAll = (err) => {
    for (const [, entry] of pending) entry.reject(err);
    pending.clear();
  };
  socket.on('error', (err) => failAll(err));
  socket.on('close', () => {
    if (!closed) failAll(new Error('session daemon connection closed'));
  });

  function request(frame, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('session daemon request timed out'));
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      pending.set(id, {
        resolve: (res) => {
          clearTimeout(timer);
          resolve(res);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      socket.write(FrameParser.encode({ id, ...frame }));
    });
  }

  async function call(tool, args = {}) {
    const res = await request({ type: 'call', tool, args });
    if (!res.ok) {
      // Carry the daemon's kind/hint (e.g. kind:'timeout' + partial-execution
      // hint) so the CLI can surface them instead of defaulting to 'device'.
      const e = new Error((res.error && res.error.message) || 'session call failed');
      if (res.error && res.error.kind) e.kind = res.error.kind;
      if (res.error && res.error.hint) e.hint = res.error.hint;
      throw e;
    }
    return res.result;
  }

  function close() {
    closed = true;
    try {
      socket.end();
    } catch (_) {
      /* ignore */
    }
    return Promise.resolve();
  }

  return { call, close, request };
}

// Returns { call, close } against a live daemon, or null when unreachable.
async function tryConnect(projectRoot, socketDeps) {
  const client = await connectVerified(projectRoot, socketDeps);
  if (!client) return null;
  const { call, close } = client;
  return { call, close };
}

// Liveness probe: connect + ping. Returns the handle device on success, false
// otherwise. Used to decide daemon-vs-oneshot and to poll a spawned daemon.
async function isAlive(projectRoot, socketDeps) {
  const client = await connectVerified(projectRoot, socketDeps);
  if (!client) return false;
  try {
    const res = await client.request({ type: 'ping' }, { timeoutMs: 2000 });
    return !!(res && res.ok);
  } catch (_) {
    return false;
  } finally {
    await client.close();
  }
}

// Ask a live daemon to shut down. Resolves true when a daemon acknowledged,
// false when none was reachable.
async function requestShutdown(projectRoot, socketDeps) {
  const client = await connectVerified(projectRoot, socketDeps);
  if (!client) return false;
  try {
    const res = await client.request({ type: 'shutdown' }, { timeoutMs: 5000 });
    return !!(res && res.ok);
  } catch (_) {
    return false;
  } finally {
    await client.close();
  }
}

// Rich status probe: connect + ping and report whether a daemon is running,
// how many device calls are currently in flight (the double-execution window
// is visible here), and which device it is pinned to. `null`s when not running.
//
// A daemon whose engine has died is NOT running (#156): it is draining toward
// its own exit and can never serve a call. Only an explicit engine_alive:false
// counts — a pre-0.28 daemon omits the field and is treated as alive.
async function getSessionStatus(projectRoot, socketDeps) {
  const down = { running: false, reason: null, in_flight: null, device: null };
  const client = await connectVerified(projectRoot, socketDeps);
  if (!client) return down;
  try {
    const res = await client.request({ type: 'ping' }, { timeoutMs: 2000 });
    if (!(res && res.ok)) return down;
    const result = res.result || {};
    const seen = {
      in_flight: typeof result.in_flight === 'number' ? result.in_flight : null,
      device: result.device != null ? result.device : null,
    };
    if (result.engine_alive === false) return { running: false, reason: 'engine_exited', ...seen };
    return { running: true, reason: null, ...seen };
  } catch (_) {
    return down;
  } finally {
    await client.close();
  }
}

module.exports = { tryConnect, isAlive, requestShutdown, getSessionStatus, DEFAULT_TIMEOUT_MS, HELLO_TIMEOUT_MS };
