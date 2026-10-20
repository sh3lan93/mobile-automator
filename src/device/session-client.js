'use strict';

// Client side of the device session daemon protocol.
//
// tryConnect(projectRoot) returns a { call, close } pair shaped EXACTLY like
// mobile-mcp-client.createCall, so a daemon-backed bridge is a drop-in for a
// one-shot bridge. Returns null when no live daemon is reachable (the caller
// then falls back to a one-shot spawn). Requests are correlated by id so a
// single connection can multiplex concurrent calls.

const net = require('net');

const paths = require('./session-paths');
const { FrameParser } = require('./session-protocol');

const DEFAULT_TIMEOUT_MS = 30000;

// Connect a socket to the daemon, or resolve null if it cannot connect.
function connectSocket(socketPath) {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
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
async function tryConnect(projectRoot) {
  const socket = await connectSocket(paths.socketPath(projectRoot));
  if (!socket) return null;
  const { call, close } = wrapSocket(socket);
  return { call, close };
}

// Liveness probe: connect + ping. Returns the handle device on success, false
// otherwise. Used to decide daemon-vs-oneshot and to poll a spawned daemon.
async function isAlive(projectRoot) {
  const socket = await connectSocket(paths.socketPath(projectRoot));
  if (!socket) return false;
  const client = wrapSocket(socket);
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
async function requestShutdown(projectRoot) {
  const socket = await connectSocket(paths.socketPath(projectRoot));
  if (!socket) return false;
  const client = wrapSocket(socket);
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
async function getSessionStatus(projectRoot) {
  const down = { running: false, reason: null, in_flight: null, device: null };
  const socket = await connectSocket(paths.socketPath(projectRoot));
  if (!socket) return down;
  const client = wrapSocket(socket);
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

module.exports = { tryConnect, isAlive, requestShutdown, getSessionStatus, DEFAULT_TIMEOUT_MS };
