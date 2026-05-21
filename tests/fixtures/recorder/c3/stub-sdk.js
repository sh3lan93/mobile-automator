#!/usr/bin/env node
'use strict';

/**
 * Stub SDK for manual smoke-testing the C3 protocol.
 *
 * Usage:
 *   node tests/fixtures/recorder/c3/stub-sdk.js <port> [--platform=android] [--app-id=com.example.app]
 *
 * Connects to a running recorder sidecar on the given TCP port, performs a
 * valid v1 handshake, then streams a canned sequence of events covering all
 * six event kinds. Intended for hand-driven smoke tests of the C3 path while
 * v1.1 SDKs are still in development.
 */

const net = require('net');

const args = process.argv.slice(2);
const port = parseInt(args[0], 10);
if (!Number.isInteger(port)) {
  process.stderr.write('usage: stub-sdk.js <port> [--platform=android|ios] [--app-id=<id>]\n');
  process.exit(2);
}

function flag(name, def) {
  const match = args.find((a) => a.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : def;
}

const platform = flag('platform', 'android');
const appId = flag('app-id', 'com.example.app');

const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
  socket.write(JSON.stringify({ v: 1, platform, app_id: appId, sdk_version: '0.0.0-stub' }) + '\n');
});

let buffer = '';
let handshaken = false;
socket.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (!handshaken) {
      if (msg.ok) {
        handshaken = true;
        process.stdout.write(`handshake accepted: session_id=${msg.session_id}\n`);
        sendCannedEvents();
      } else {
        process.stderr.write(`handshake rejected: ${msg.reason}\n`);
        socket.end();
        process.exit(1);
      }
    } else {
      process.stdout.write(`from sidecar: ${line}\n`);
    }
  }
});

socket.on('error', (err) => {
  process.stderr.write(`socket error: ${err.message}\n`);
  process.exit(1);
});

function sendCannedEvents() {
  const events = [
    { kind: 'lifecycle', t: 0, event: 'app_launched' },
    { kind: 'tap', t: 1200, x: 540, y: 1090, target_id: 'login_button', target_label: 'Login' },
    { kind: 'type', t: 2400, value: 'test@example.com', field_id: 'email_input', field_label: 'Email' },
    { kind: 'tap', t: 3600, x: 540, y: 1400, target_id: 'submit_button', target_label: 'Submit' },
    { kind: 'swipe', t: 4800, from: [540, 1300], to: [540, 600], duration_ms: 240 },
    { kind: 'key', t: 6000, value: 'BACK' },
    { kind: 'error', t: 7200, message: 'sample diagnostic', fatal: false },
    { kind: 'lifecycle', t: 8000, event: 'app_backgrounded' },
  ];
  let i = 0;
  const sendNext = () => {
    if (i >= events.length) {
      process.stdout.write('all events sent; closing\n');
      socket.end();
      return;
    }
    socket.write(JSON.stringify(events[i]) + '\n');
    i += 1;
    setTimeout(sendNext, 50);
  };
  sendNext();
}
