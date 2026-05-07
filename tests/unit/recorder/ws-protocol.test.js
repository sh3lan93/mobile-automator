'use strict';

const WebSocket = require('ws');
const { startHttpServer } = require('../../../tools/recorder/src/server/http-server');
const { attachWsServer } = require('../../../tools/recorder/src/server/ws-protocol');
const fs = require('fs');
const path = require('path');
const os = require('os');

function connect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

describe('ws-protocol', () => {
  let projectRoot;
  let httpSrv;
  let wsCtx;

  beforeEach(async () => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-ws-'));
    fs.mkdirSync(path.join(projectRoot, 'mobile-automator', '.recorder', 's'), { recursive: true });
    httpSrv = await startHttpServer({ projectRoot, scenarioId: 's' });
    wsCtx = attachWsServer({ httpServer: httpSrv.server });
  });

  afterEach(async () => {
    await httpSrv.close();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  test('client connects and receives initial mode message', async () => {
    wsCtx.broadcast({ type: 'mode', mode: 'platform-agnostic' });
    const ws = await connect(httpSrv.port);
    const msg = await new Promise((res) => ws.once('message', (data) => res(JSON.parse(data.toString()))));
    expect(msg).toEqual({ type: 'mode', mode: 'platform-agnostic' });
    ws.close();
  });

  test('broadcast sends step-added to all clients', async () => {
    const ws1 = await connect(httpSrv.port);
    const ws2 = await connect(httpSrv.port);
    const msgs = [];
    ws1.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    ws2.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    wsCtx.broadcast({ type: 'step-added', step: { id: 'tap_login', display: 'Tap Login' } });
    await new Promise((r) => setTimeout(r, 50));
    expect(msgs.filter((m) => m.type === 'step-added')).toHaveLength(2);
    ws1.close();
    ws2.close();
  });

  test('GUI→sidecar messages invoke registered handlers', async () => {
    const seen = [];
    wsCtx.onMessage((msg) => seen.push(msg));
    const ws = await connect(httpSrv.port);
    ws.send(JSON.stringify({ type: 'cancel' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(seen).toEqual([{ type: 'cancel' }]);
    ws.close();
  });

  test('disconnect callback fires when client closes', async () => {
    let disconnected = false;
    wsCtx.onDisconnect(() => { disconnected = true; });
    const ws = await connect(httpSrv.port);
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(disconnected).toBe(true);
  });

  test('onConnect callback fires when client connects', async () => {
    let connected = false;
    wsCtx.onConnect(() => { connected = true; });
    const ws = await connect(httpSrv.port);
    await new Promise((r) => setTimeout(r, 50));
    expect(connected).toBe(true);
    ws.close();
  });
});
