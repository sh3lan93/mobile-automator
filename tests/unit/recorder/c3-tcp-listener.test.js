'use strict';

const net = require('net');
const { createTcpListener } = require('../../../tools/recorder/src/c3/tcp-listener');

function connect(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => resolve(socket));
    socket.once('error', reject);
  });
}

function readLine(socket) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const idx = buffer.indexOf('\n');
      if (idx >= 0) {
        socket.off('data', onData);
        resolve(buffer.slice(0, idx));
      }
    };
    socket.on('data', onData);
    socket.once('error', reject);
  });
}

function send(socket, obj) {
  socket.write(JSON.stringify(obj) + '\n');
}

function nextEvent(emitter, name) {
  return new Promise((resolve) => emitter.once(name, resolve));
}

async function closed(socket) {
  if (socket.destroyed) return;
  await new Promise((resolve) => socket.once('close', resolve));
}

describe('c3-tcp-listener', () => {
  let listener;

  afterEach(async () => {
    if (listener) {
      await listener.close();
      listener = null;
    }
  });

  test('binds to 127.0.0.1 on an OS-assigned port', async () => {
    listener = await createTcpListener({ sessionId: 's1' });
    const addr = listener.server.address();
    expect(addr.address).toBe('127.0.0.1');
    expect(addr.port).toBeGreaterThan(0);
    expect(listener.port).toBe(addr.port);
  });

  test('valid v1 handshake gets accepted and emits handshake event', async () => {
    listener = await createTcpListener({ sessionId: 's2' });
    const handshakePromise = nextEvent(listener.emitter, 'handshake');
    const socket = await connect(listener.port);

    send(socket, { v: 1, platform: 'android', app_id: 'com.example.app', sdk_version: '1.0.0' });
    const reply = JSON.parse(await readLine(socket));
    const handshake = await handshakePromise;

    expect(reply).toEqual({ ok: true, session_id: 's2' });
    expect(handshake.platform).toBe('android');
    expect(handshake.app_id).toBe('com.example.app');
    socket.end();
  });

  test('handshake with unsupported version is rejected and connection closes', async () => {
    listener = await createTcpListener({ sessionId: 's3' });
    const socket = await connect(listener.port);

    send(socket, { v: 2, platform: 'android', app_id: 'com.example.app', sdk_version: '1.0.0' });
    const reply = JSON.parse(await readLine(socket));
    await closed(socket);

    expect(reply).toEqual({ ok: false, reason: 'version_unsupported' });
  });

  test('platform mismatch is rejected', async () => {
    listener = await createTcpListener({ sessionId: 's4', expectedPlatform: 'android' });
    const socket = await connect(listener.port);

    send(socket, { v: 1, platform: 'ios', app_id: 'com.example.app', sdk_version: '1.0.0' });
    const reply = JSON.parse(await readLine(socket));
    await closed(socket);

    expect(reply).toEqual({ ok: false, reason: 'platform_mismatch' });
  });

  test('app_id mismatch is rejected', async () => {
    listener = await createTcpListener({ sessionId: 's5', expectedAppId: 'com.expected.app' });
    const socket = await connect(listener.port);

    send(socket, { v: 1, platform: 'android', app_id: 'com.wrong.app', sdk_version: '1.0.0' });
    const reply = JSON.parse(await readLine(socket));
    await closed(socket);

    expect(reply).toEqual({ ok: false, reason: 'app_id_mismatch' });
  });

  test('malformed JSON before handshake is rejected', async () => {
    listener = await createTcpListener({ sessionId: 's6' });
    const socket = await connect(listener.port);

    socket.write('this is not json\n');
    const reply = JSON.parse(await readLine(socket));
    await closed(socket);

    expect(reply).toEqual({ ok: false, reason: 'malformed' });
  });

  test('handshake missing required field is rejected as malformed', async () => {
    listener = await createTcpListener({ sessionId: 's7' });
    const socket = await connect(listener.port);

    send(socket, { v: 1, platform: 'android' });
    const reply = JSON.parse(await readLine(socket));
    await closed(socket);

    expect(reply).toEqual({ ok: false, reason: 'malformed' });
  });

  test('events after handshake are emitted via the event channel', async () => {
    listener = await createTcpListener({ sessionId: 's8' });
    const received = [];
    listener.emitter.on('event', (ev) => received.push(ev));

    const socket = await connect(listener.port);
    send(socket, { v: 1, platform: 'android', app_id: 'com.example.app', sdk_version: '1.0.0' });
    await readLine(socket);

    send(socket, { kind: 'tap', t: 100, x: 50, y: 60 });
    send(socket, { kind: 'type', t: 200, value: 'hello' });
    send(socket, { kind: 'key', t: 300, value: 'BACK' });
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toEqual([
      { kind: 'tap', t: 100, x: 50, y: 60 },
      { kind: 'type', t: 200, value: 'hello' },
      { kind: 'key', t: 300, value: 'BACK' },
    ]);
    socket.end();
  });

  test('malformed line after handshake emits parse_error but keeps connection open', async () => {
    listener = await createTcpListener({ sessionId: 's9' });
    const parseErrors = [];
    const events = [];
    listener.emitter.on('parse_error', (info) => parseErrors.push(info));
    listener.emitter.on('event', (ev) => events.push(ev));

    const socket = await connect(listener.port);
    send(socket, { v: 1, platform: 'android', app_id: 'com.example.app', sdk_version: '1.0.0' });
    await readLine(socket);

    socket.write('not json at all\n');
    send(socket, { kind: 'tap', t: 500, x: 10, y: 20 });
    await new Promise((r) => setTimeout(r, 50));

    expect(parseErrors).toHaveLength(1);
    expect(events).toEqual([{ kind: 'tap', t: 500, x: 10, y: 20 }]);
    expect(socket.destroyed).toBe(false);
    socket.end();
  });

  test('chunked TCP delivery is buffered correctly', async () => {
    listener = await createTcpListener({ sessionId: 's10' });
    const events = [];
    listener.emitter.on('event', (ev) => events.push(ev));

    const socket = await connect(listener.port);
    send(socket, { v: 1, platform: 'android', app_id: 'com.example.app', sdk_version: '1.0.0' });
    await readLine(socket);

    const payload = JSON.stringify({ kind: 'tap', t: 700, x: 1, y: 2 }) + '\n';
    socket.write(payload.slice(0, 5));
    await new Promise((r) => setTimeout(r, 20));
    socket.write(payload.slice(5));
    await new Promise((r) => setTimeout(r, 50));

    expect(events).toEqual([{ kind: 'tap', t: 700, x: 1, y: 2 }]);
    socket.end();
  });

  test('multiple JSON lines arriving in a single chunk are split correctly', async () => {
    listener = await createTcpListener({ sessionId: 's11' });
    const events = [];
    listener.emitter.on('event', (ev) => events.push(ev));

    const socket = await connect(listener.port);
    send(socket, { v: 1, platform: 'android', app_id: 'com.example.app', sdk_version: '1.0.0' });
    await readLine(socket);

    const combined =
      JSON.stringify({ kind: 'tap', t: 1, x: 1, y: 2 }) + '\n' +
      JSON.stringify({ kind: 'swipe', t: 2, from: [0, 0], to: [10, 10] }) + '\n' +
      JSON.stringify({ kind: 'lifecycle', t: 3, event: 'app_launched' }) + '\n';
    socket.write(combined);
    await new Promise((r) => setTimeout(r, 50));

    expect(events.map((e) => e.kind)).toEqual(['tap', 'swipe', 'lifecycle']);
    socket.end();
  });

  test('client_disconnect fires when the client closes', async () => {
    listener = await createTcpListener({ sessionId: 's12' });
    const disconnects = [];
    listener.emitter.on('client_disconnect', () => disconnects.push(Date.now()));

    const socket = await connect(listener.port);
    send(socket, { v: 1, platform: 'android', app_id: 'com.example.app', sdk_version: '1.0.0' });
    await readLine(socket);
    socket.end();
    await new Promise((r) => setTimeout(r, 50));

    expect(disconnects).toHaveLength(1);
  });

  test('close() shuts down the listener', async () => {
    listener = await createTcpListener({ sessionId: 's13' });
    await listener.close();
    await expect(connect(listener.port)).rejects.toThrow();
    listener = null;
  });

  test('CR before LF is tolerated', async () => {
    listener = await createTcpListener({ sessionId: 's14' });
    const events = [];
    listener.emitter.on('event', (ev) => events.push(ev));

    const socket = await connect(listener.port);
    socket.write(JSON.stringify({ v: 1, platform: 'android', app_id: 'com.example.app', sdk_version: '1.0.0' }) + '\r\n');
    await readLine(socket);

    socket.write(JSON.stringify({ kind: 'tap', t: 1, x: 1, y: 2 }) + '\r\n');
    await new Promise((r) => setTimeout(r, 50));

    expect(events).toEqual([{ kind: 'tap', t: 1, x: 1, y: 2 }]);
    socket.end();
  });
});
