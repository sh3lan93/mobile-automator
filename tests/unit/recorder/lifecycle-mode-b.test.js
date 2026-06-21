'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');
const { startModeB } = require('../../../tools/recorder/src/lifecycle/mode-b');

function setupProject({ mode = 'platform-aware' } = {}) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mode-b-'));
  fs.mkdirSync(path.join(projectRoot, 'mobile-automator'), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, 'mobile-automator', 'config.json'),
    JSON.stringify({ mode, app_package: 'com.example.app' }, null, 2),
  );
  return projectRoot;
}

function makeFakeStore() {
  return {
    appendEvent: jest.fn(),
    cleanupOnCancel: jest.fn(),
    cleanupOnSuccess: jest.fn(),
    writeHierarchySnapshot: jest.fn(),
    writeCrashLog: jest.fn(),
    appendEdit: jest.fn(),
    appendAssertion: jest.fn(),
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
    clientCount() { return 1; },
    close: jest.fn(),
    _broadcasts: broadcasts,
    _simulateMessage(msg) { for (const h of messageHandlers) h(msg); },
  };
}

function makeFakeMcpBridge() {
  return {
    listElementsOnScreen: jest.fn().mockResolvedValue({ elements: [] }),
    takeScreenshot: jest.fn().mockResolvedValue('/tmp/foo.png'),
    launchApp: jest.fn().mockResolvedValue(undefined),
    getCrash: jest.fn().mockResolvedValue(null),
  };
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

describe('startModeB (lifecycle/mode-b)', () => {
  let projectRoot;
  beforeEach(() => { projectRoot = setupProject(); });
  afterEach(() => { fs.rmSync(projectRoot, { recursive: true, force: true }); });

  test('starts hierarchy poller (calls mcpBridge.listElementsOnScreen)', async () => {
    const mcpBridge = makeFakeMcpBridge();
    const wsCtx = makeFakeWsCtx();
    const store = makeFakeStore();

    const exit = startModeB({
      store, wsCtx, httpSrv: {}, projectRoot, scenarioId: 's',
      platform: 'android', appPackage: 'com.example.app',
      deps: { mcpBridge, pollIntervalMs: 20 },
    });

    await wait(60);
    expect(mcpBridge.listElementsOnScreen).toHaveBeenCalled();

    wsCtx._simulateMessage({ type: 'save' });
    await exit;
  });

  test('WS "save" resolves with exit code 0', async () => {
    const wsCtx = makeFakeWsCtx();
    const store = makeFakeStore();
    const exit = startModeB({
      store, wsCtx, httpSrv: {}, projectRoot, scenarioId: 's',
      platform: 'android', appPackage: 'com.example.app',
      deps: { mcpBridge: makeFakeMcpBridge(), pollIntervalMs: 9999 },
    });
    await wait(5);
    wsCtx._simulateMessage({ type: 'save' });
    const code = await exit;
    expect(code).toBe(0);
    expect(store.cleanupOnCancel).not.toHaveBeenCalled();
  });

  test('WS "cancel" resolves 130 AND calls store.cleanupOnCancel', async () => {
    const wsCtx = makeFakeWsCtx();
    const store = makeFakeStore();
    const exit = startModeB({
      store, wsCtx, httpSrv: {}, projectRoot, scenarioId: 's',
      platform: 'android', appPackage: 'com.example.app',
      deps: { mcpBridge: makeFakeMcpBridge(), pollIntervalMs: 9999 },
    });
    await wait(5);
    wsCtx._simulateMessage({ type: 'cancel' });
    const code = await exit;
    expect(code).toBe(130);
    expect(store.cleanupOnCancel).toHaveBeenCalled();
  });

  test('failure orchestrator attached → device-watchdog trip resolves onDone(2)', async () => {
    const wsCtx = makeFakeWsCtx();
    const store = makeFakeStore();
    const capturedDeps = {};
    const attachFailureModes = jest.fn((opts) => {
      capturedDeps.onDone = opts.onDone;
      return { deviceWatchdog: {}, crashWatchdog: { stop() {} }, browserWatchdog: { stop() {} } };
    });

    const exit = startModeB({
      store, wsCtx, httpSrv: {}, projectRoot, scenarioId: 's',
      platform: 'android', appPackage: 'com.example.app',
      deps: { mcpBridge: makeFakeMcpBridge(), pollIntervalMs: 9999, attachFailureModes },
    });

    await wait(5);
    expect(attachFailureModes).toHaveBeenCalledTimes(1);
    // Simulate the failure-orchestrator deciding to terminate with code 2.
    capturedDeps.onDone(2);

    const code = await exit;
    expect(code).toBe(2);
  });

  test('tapSource feeds the classifier (live taps land in store.appendEvent)', async () => {
    const wsCtx = makeFakeWsCtx();
    const store = makeFakeStore();
    const tapSource = new EventEmitter();

    const exit = startModeB({
      store, wsCtx, httpSrv: {}, projectRoot, scenarioId: 's',
      platform: 'android', appPackage: 'com.example.app',
      deps: { mcpBridge: makeFakeMcpBridge(), pollIntervalMs: 9999, tapSource },
    });

    await wait(5);
    // Emit a down+up pair so the gesture classifier produces a tap.
    tapSource.emit('tap', { t: 1, kind: 'down', x: 100, y: 200 });
    tapSource.emit('tap', { t: 50, kind: 'up', x: 100, y: 200 });

    wsCtx._simulateMessage({ type: 'save' });
    await exit;
    // At least one event flushed (taps land via classifier.flush() on finish).
    expect(store.appendEvent).toHaveBeenCalled();
  });

  test('broadcasts step-added when a tap is captured (#103 defect B)', async () => {
    const tapSource = new EventEmitter();
    const wsCtx = makeFakeWsCtx();
    const store = makeFakeStore();

    const exit = startModeB({
      store, wsCtx, httpSrv: {}, projectRoot, scenarioId: 's',
      platform: 'android', appPackage: 'com.example.app',
      deps: { mcpBridge: makeFakeMcpBridge(), pollIntervalMs: 9999, tapSource },
    });

    await wait(5);
    // Drive a canonical tap: down then up at the same coordinate.
    // The gesture classifier buffers a single tap as _pending until flush().
    // finish() calls classifier.flush() synchronously before resolveExit,
    // so the step-added broadcast fires before the exit promise resolves.
    tapSource.emit('tap', { t: 0, kind: 'down', x: 100, y: 200 });
    tapSource.emit('tap', { t: 80, kind: 'up', x: 100, y: 200 });

    wsCtx._simulateMessage({ type: 'save' });
    await exit;

    const added = wsCtx._broadcasts.filter((m) => m.type === 'step-added');
    expect(added).toHaveLength(1);
    expect(added[0].step).toMatchObject({ index: 1, action: 'tap' });
  });
});
