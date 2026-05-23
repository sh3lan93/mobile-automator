'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

const { createTcpListener } = require('../../../tools/recorder/src/c3/tcp-listener');
const { ArtifactsStore } = require('../../../tools/recorder/src/artifacts');

/**
 * Integration test for the C3 capture pipeline.
 *
 * Spins up a real TCP listener over loopback, wires it to a real
 * ArtifactsStore on a tmpdir, then connects a scripted "fake SDK" client
 * that performs a valid handshake and streams the six canonical event
 * kinds. We assert that the resulting events.jsonl is line-for-line equal
 * to what the SDK sent, in the order it was sent.
 *
 * This complements the Phase B unit tests (which exercise the listener in
 * isolation via injected deps) by checking that the listener + store
 * compose correctly with no mocks in the middle.
 */

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

function connect(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => resolve(socket));
    socket.once('error', reject);
  });
}

function send(socket, obj) {
  socket.write(JSON.stringify(obj) + '\n');
}

describe('C3 pipeline integration', () => {
  let projectRoot;
  let listener;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-c3-int-'));
    fs.mkdirSync(path.join(projectRoot, 'mobile-automator'));
  });

  afterEach(async () => {
    if (listener) {
      await listener.close();
      listener = null;
    }
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  test('a scripted SDK round-trips all six event kinds into events.jsonl', async () => {
    const store = new ArtifactsStore({ projectRoot, scenarioId: 'c3_round_trip' });
    store.init({ mode: 'platform-aware', scenario_id: 'c3_round_trip' });

    listener = await createTcpListener({ sessionId: 'c3_round_trip' });
    listener.emitter.on('event', (ev) => store.appendEvent(ev));

    const socket = await connect(listener.port);
    send(socket, { v: 1, platform: 'android', app_id: 'com.example.app', sdk_version: '1.0.0' });
    const reply = JSON.parse(await readLine(socket));
    expect(reply).toEqual({ ok: true, session_id: 'c3_round_trip' });

    const events = [
      { kind: 'lifecycle', t: 0, event: 'app_launched' },
      { kind: 'tap', t: 100, x: 540, y: 1090, target_id: 'login_button', target_label: 'Login' },
      { kind: 'type', t: 200, value: 'test@example.com', field_id: 'email', field_label: 'Email', sensitive: false },
      { kind: 'swipe', t: 300, from: [540, 1300], to: [540, 600], duration_ms: 220 },
      { kind: 'key', t: 400, value: 'BACK' },
      { kind: 'error', t: 500, message: 'transient log', fatal: false },
    ];
    for (const ev of events) send(socket, ev);

    // Give the listener a couple of event loop turns to flush parsing.
    await new Promise((r) => setTimeout(r, 100));
    socket.end();
    await new Promise((r) => setTimeout(r, 50));

    const jsonlPath = path.join(projectRoot, 'mobile-automator/.recorder/c3_round_trip/events.jsonl');
    const lines = fs.readFileSync(jsonlPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toEqual(events);
  });

  test('all six event kinds are emitted with t monotonically non-decreasing', async () => {
    const store = new ArtifactsStore({ projectRoot, scenarioId: 'c3_monotonic' });
    store.init({ mode: 'platform-aware', scenario_id: 'c3_monotonic' });

    listener = await createTcpListener({ sessionId: 'c3_monotonic' });
    listener.emitter.on('event', (ev) => store.appendEvent(ev));

    const socket = await connect(listener.port);
    send(socket, { v: 1, platform: 'ios', app_id: 'com.example.app', sdk_version: '1.0.0' });
    await readLine(socket);

    const kinds = ['lifecycle', 'tap', 'type', 'swipe', 'key', 'error'];
    let t = 0;
    for (const kind of kinds) {
      send(socket, { kind, t, sample: 'payload' });
      t += 50;
    }
    await new Promise((r) => setTimeout(r, 100));
    socket.end();
    await new Promise((r) => setTimeout(r, 50));

    const jsonlPath = path.join(projectRoot, 'mobile-automator/.recorder/c3_monotonic/events.jsonl');
    const lines = fs.readFileSync(jsonlPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => l.kind)).toEqual(kinds);
    const timestamps = lines.map((l) => l.t);
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
  });

  test('events.jsonl from C3 is structurally a JSONL stream (one JSON per line)', async () => {
    const store = new ArtifactsStore({ projectRoot, scenarioId: 'c3_jsonl' });
    store.init({ mode: 'platform-aware', scenario_id: 'c3_jsonl' });

    listener = await createTcpListener({ sessionId: 'c3_jsonl' });
    listener.emitter.on('event', (ev) => store.appendEvent(ev));

    const socket = await connect(listener.port);
    send(socket, { v: 1, platform: 'android', app_id: 'com.example.app', sdk_version: '1.0.0' });
    await readLine(socket);

    send(socket, { kind: 'tap', t: 1, x: 10, y: 20 });
    send(socket, { kind: 'tap', t: 2, x: 30, y: 40 });
    await new Promise((r) => setTimeout(r, 80));
    socket.end();
    await new Promise((r) => setTimeout(r, 50));

    const raw = fs.readFileSync(
      path.join(projectRoot, 'mobile-automator/.recorder/c3_jsonl/events.jsonl'),
      'utf8',
    );
    expect(raw.endsWith('\n')).toBe(true);
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  test('handshake rejection writes nothing to events.jsonl', async () => {
    const store = new ArtifactsStore({ projectRoot, scenarioId: 'c3_reject' });
    store.init({ mode: 'platform-aware', scenario_id: 'c3_reject' });

    listener = await createTcpListener({ sessionId: 'c3_reject', expectedPlatform: 'android' });
    listener.emitter.on('event', (ev) => store.appendEvent(ev));

    const socket = await connect(listener.port);
    send(socket, { v: 1, platform: 'ios', app_id: 'com.example.app', sdk_version: '1.0.0' });
    const reply = JSON.parse(await readLine(socket));
    expect(reply).toEqual({ ok: false, reason: 'platform_mismatch' });

    // Even if the (rejected) client tries to push events, they must be ignored.
    socket.write(JSON.stringify({ kind: 'tap', t: 1, x: 1, y: 2 }) + '\n');
    await new Promise((r) => setTimeout(r, 80));

    const jsonl = fs.readFileSync(
      path.join(projectRoot, 'mobile-automator/.recorder/c3_reject/events.jsonl'),
      'utf8',
    );
    expect(jsonl).toBe('');
  });
});
