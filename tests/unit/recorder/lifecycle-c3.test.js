'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');
const { startC3 } = require('../../../tools/recorder/src/lifecycle/c3');

function setupProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'c3-life-'));
}

function makeFakeListener() {
  const emitter = new EventEmitter();
  const close = jest.fn().mockResolvedValue(undefined);
  return {
    emitter,
    port: 4242,
    server: {},
    close,
  };
}

function makeFakeStore() {
  return {
    appendEvent: jest.fn(),
    cleanupOnCancel: jest.fn(),
  };
}

function makeFakeWsCtx() {
  const messageHandlers = [];
  const broadcasts = [];
  return {
    broadcast: jest.fn((msg) => broadcasts.push(msg)),
    onMessage(fn) { messageHandlers.push(fn); },
    onConnect() {},
    onDisconnect() {},
    clientCount() { return 0; },
    close: jest.fn(),
    _broadcasts: broadcasts,
    _simulateMessage(msg) { for (const h of messageHandlers) h(msg); },
  };
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('startC3 (lifecycle/c3)', () => {
  let projectRoot;
  beforeEach(() => { projectRoot = setupProject(); });
  afterEach(() => { fs.rmSync(projectRoot, { recursive: true, force: true }); });

  test('writes port file and sets env var on start', async () => {
    const listener = makeFakeListener();
    const wsCtx = makeFakeWsCtx();
    const store = makeFakeStore();
    const sessionId = 'login_flow';

    const exit = startC3({
      store, wsCtx, httpSrv: {}, sessionId, projectRoot,
      platform: 'android', appPackage: 'com.example.app',
      deps: {
        createTcpListener: jest.fn().mockResolvedValue(listener),
        handshakeTimeoutMs: 50,
      },
    });

    await wait(10);
    const portPath = path.join(projectRoot, 'mobile-automator', '.recorder', sessionId, 'recorder-c3.port');
    expect(fs.existsSync(portPath)).toBe(true);
    const portJson = JSON.parse(fs.readFileSync(portPath, 'utf8'));
    expect(portJson).toEqual({ port: 4242, v: 1, session_id: sessionId });
    expect(process.env.MOBILE_AUTOMATOR_RECORDER_C3_PORT).toBe('4242');

    // Save to terminate.
    wsCtx._simulateMessage({ type: 'save' });
    await exit;
    expect(fs.existsSync(portPath)).toBe(false);
    expect(process.env.MOBILE_AUTOMATOR_RECORDER_C3_PORT).toBeUndefined();
    expect(listener.close).toHaveBeenCalled();
  });

  test('successful handshake within window suppresses fallback prompt and forwards events to store', async () => {
    const listener = makeFakeListener();
    const wsCtx = makeFakeWsCtx();
    const store = makeFakeStore();

    const exit = startC3({
      store, wsCtx, httpSrv: {}, sessionId: 's',
      projectRoot, platform: 'android', appPackage: 'app',
      deps: {
        createTcpListener: jest.fn().mockResolvedValue(listener),
        handshakeTimeoutMs: 30,
      },
    });

    await wait(5);
    listener.emitter.emit('handshake', { v: 1, platform: 'android', app_id: 'app', sdk_version: '1.0.0' });
    listener.emitter.emit('event', { kind: 'tap', t: 1, x: 10, y: 20 });
    listener.emitter.emit('event', { kind: 'type', t: 2, value: 'hello' });

    await wait(60); // exceed the timeout window
    const fallbackSent = wsCtx._broadcasts.some((b) => b.type === 'c3-fallback-prompt');
    expect(fallbackSent).toBe(false);
    expect(store.appendEvent).toHaveBeenCalledWith({ kind: 'tap', t: 1, x: 10, y: 20 });
    expect(store.appendEvent).toHaveBeenCalledWith({ kind: 'type', t: 2, value: 'hello' });

    wsCtx._simulateMessage({ type: 'save' });
    await exit;
  });

  test('10s timeout with no handshake broadcasts c3-fallback-prompt', async () => {
    const listener = makeFakeListener();
    const wsCtx = makeFakeWsCtx();
    const store = makeFakeStore();

    const exit = startC3({
      store, wsCtx, httpSrv: {}, sessionId: 's',
      projectRoot, platform: 'android', appPackage: 'app',
      deps: {
        createTcpListener: jest.fn().mockResolvedValue(listener),
        handshakeTimeoutMs: 20,
      },
    });

    await wait(40);
    expect(wsCtx._broadcasts).toContainEqual({ type: 'c3-fallback-prompt', reason: 'sdk_timeout' });

    wsCtx._simulateMessage({ type: 'c3-fallback-choice', choice: 'cancel' });
    const code = await exit;
    expect(code).toBe(130);
  });

  test('fallback choice "use_mode_b" delegates to startModeB', async () => {
    const listener = makeFakeListener();
    const wsCtx = makeFakeWsCtx();
    const store = makeFakeStore();
    const startModeB = jest.fn().mockResolvedValue(7);

    const exit = startC3({
      store, wsCtx, httpSrv: {}, sessionId: 's',
      projectRoot, platform: 'android', appPackage: 'app',
      deps: {
        createTcpListener: jest.fn().mockResolvedValue(listener),
        handshakeTimeoutMs: 10,
        startModeB,
      },
    });

    await wait(30); // wait for fallback prompt
    wsCtx._simulateMessage({ type: 'c3-fallback-choice', choice: 'use_mode_b' });
    const code = await exit;
    expect(startModeB).toHaveBeenCalledTimes(1);
    expect(startModeB.mock.calls[0][0]).toEqual(expect.objectContaining({
      store, wsCtx, projectRoot, platform: 'android', appPackage: 'app', scenarioId: 's',
    }));
    expect(code).toBe(7);
    expect(listener.close).toHaveBeenCalled();
  });

  test('fallback choice "cancel" broadcasts recording-cancelled and resolves 130', async () => {
    const listener = makeFakeListener();
    const wsCtx = makeFakeWsCtx();
    const store = makeFakeStore();

    const exit = startC3({
      store, wsCtx, httpSrv: {}, sessionId: 's',
      projectRoot, platform: 'android', appPackage: 'app',
      deps: {
        createTcpListener: jest.fn().mockResolvedValue(listener),
        handshakeTimeoutMs: 10,
      },
    });

    await wait(30);
    wsCtx._simulateMessage({ type: 'c3-fallback-choice', choice: 'cancel' });
    const code = await exit;
    expect(code).toBe(130);
    expect(wsCtx._broadcasts).toContainEqual({ type: 'recording-cancelled' });
    expect(store.cleanupOnCancel).toHaveBeenCalled();
  });

  test('port file is removed on shutdown', async () => {
    const listener = makeFakeListener();
    const wsCtx = makeFakeWsCtx();
    const store = makeFakeStore();
    const sessionId = 'cleanup_session';

    const exit = startC3({
      store, wsCtx, httpSrv: {}, sessionId, projectRoot,
      platform: 'android', appPackage: 'app',
      deps: {
        createTcpListener: jest.fn().mockResolvedValue(listener),
        handshakeTimeoutMs: 50,
      },
    });

    await wait(5);
    const portPath = path.join(projectRoot, 'mobile-automator', '.recorder', sessionId, 'recorder-c3.port');
    expect(fs.existsSync(portPath)).toBe(true);

    wsCtx._simulateMessage({ type: 'cancel' });
    await exit;
    expect(fs.existsSync(portPath)).toBe(false);
  });
});
