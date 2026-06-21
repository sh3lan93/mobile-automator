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
const { encodeRequest, FrameParser } = require('./session-protocol');

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
      socket.write(encodeRequest({ id, ...frame }));
    });
  }

  async function call(tool, args = {}) {
    const res = await request({ type: 'call', tool, args });
    if (!res.ok) throw new Error((res.error && res.error.message) || 'session call failed');
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

module.exports = { tryConnect, isAlive, requestShutdown };
