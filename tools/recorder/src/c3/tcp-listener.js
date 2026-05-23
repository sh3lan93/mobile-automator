'use strict';

const net = require('net');
const { EventEmitter } = require('events');

const LOOPBACK = new Set(['127.0.0.1', '::ffff:127.0.0.1']);

function validateHandshake(msg) {
  if (!msg || typeof msg !== 'object') return 'malformed';
  if (msg.v !== 1) return 'version_unsupported';
  if (typeof msg.platform !== 'string') return 'malformed';
  if (typeof msg.app_id !== 'string') return 'malformed';
  if (typeof msg.sdk_version !== 'string') return 'malformed';
  return null;
}

function rejectAndClose(socket, reason) {
  try {
    socket.write(JSON.stringify({ ok: false, reason }) + '\n');
  } catch (_) {
    // best-effort write
  }
  socket.end();
}

function attachConnection({ socket, emitter, sessionId, expectedPlatform, expectedAppId }) {
  if (!LOOPBACK.has(socket.remoteAddress)) {
    socket.destroy();
    return;
  }

  let buffer = '';
  let handshaken = false;

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const rawLine = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      const line = rawLine.replace(/\r$/, '').trim();
      if (!line) continue;

      let msg;
      try {
        msg = JSON.parse(line);
      } catch (err) {
        if (!handshaken) {
          rejectAndClose(socket, 'malformed');
          return;
        }
        emitter.emit('parse_error', { line, error: err });
        continue;
      }

      if (!handshaken) {
        const fieldError = validateHandshake(msg);
        if (fieldError) {
          rejectAndClose(socket, fieldError);
          return;
        }
        if (expectedPlatform && msg.platform !== expectedPlatform) {
          rejectAndClose(socket, 'platform_mismatch');
          return;
        }
        if (expectedAppId && msg.app_id !== expectedAppId) {
          rejectAndClose(socket, 'app_id_mismatch');
          return;
        }
        socket.write(JSON.stringify({ ok: true, session_id: sessionId }) + '\n');
        handshaken = true;
        emitter.emit('handshake', msg);
        continue;
      }

      emitter.emit('event', msg);
    }
  });

  socket.on('error', (err) => emitter.emit('socket_error', err));
  socket.on('close', () => emitter.emit('client_disconnect'));
}

function createTcpListener({ sessionId, expectedPlatform, expectedAppId } = {}) {
  if (!sessionId) {
    return Promise.reject(new Error('createTcpListener requires sessionId'));
  }

  const emitter = new EventEmitter();
  const server = net.createServer((socket) => {
    attachConnection({ socket, emitter, sessionId, expectedPlatform, expectedAppId });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      const { port } = server.address();
      resolve({
        server,
        emitter,
        port,
        close: () =>
          new Promise((r) => {
            server.close(() => r());
            // Force-close any lingering sockets so close() resolves promptly in tests.
            server.unref();
          }),
      });
    });
  });
}

module.exports = { createTcpListener };
