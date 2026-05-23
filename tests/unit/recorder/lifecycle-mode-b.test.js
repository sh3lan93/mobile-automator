'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
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

  test('auto-constructs a live tap source when mcpBridge.getScreenSize is available; spawns adb + ffmpeg', async () => {
    const fakeProcs = [];
    const spawn = jest.fn(() => {
      const proc = new EventEmitter();
      proc.stdout = new PassThrough();
      proc.stderr = new PassThrough();
      proc.stdin = new PassThrough();
      proc.kill = jest.fn();
      fakeProcs.push(proc);
      return proc;
    });

    const mcpBridge = makeFakeMcpBridge();
    mcpBridge.getScreenSize = jest.fn(async () => ({ width: 400, height: 200 }));

    const wsCtx = makeFakeWsCtx();
    const store = makeFakeStore();

    const exit = startModeB({
      store, wsCtx, httpSrv: {}, projectRoot, scenarioId: 's',
      platform: 'android', appPackage: 'com.example.app',
      deps: { mcpBridge, pollIntervalMs: 9999, spawn },
    });

    await wait(30); // allow async getScreenSize → spawn chain to settle
    expect(mcpBridge.getScreenSize).toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls[0][0]).toBe('adb');
    expect(spawn.mock.calls[1][0]).toBe('ffmpeg');

    wsCtx._simulateMessage({ type: 'save' });
    await exit;

    // Save → finish() → tapSource.stop() → SIGTERM both procs
    expect(fakeProcs[0].kill).toHaveBeenCalledWith('SIGTERM');
    expect(fakeProcs[1].kill).toHaveBeenCalledWith('SIGTERM');
  });

  test('does NOT auto-construct a live tap source when an explicit deps.tapSource is provided', async () => {
    const spawn = jest.fn();
    const mcpBridge = makeFakeMcpBridge();
    mcpBridge.getScreenSize = jest.fn(async () => ({ width: 400, height: 200 }));
    const tapSource = new EventEmitter();

    const wsCtx = makeFakeWsCtx();
    const store = makeFakeStore();
    const exit = startModeB({
      store, wsCtx, httpSrv: {}, projectRoot, scenarioId: 's',
      platform: 'android', appPackage: 'com.example.app',
      deps: { mcpBridge, pollIntervalMs: 9999, spawn, tapSource },
    });

    await wait(20);
    expect(spawn).not.toHaveBeenCalled();
    expect(mcpBridge.getScreenSize).not.toHaveBeenCalled();

    wsCtx._simulateMessage({ type: 'save' });
    await exit;
  });

  test('does NOT auto-construct a live tap source when mcpBridge lacks getScreenSize (back-compat)', async () => {
    const spawn = jest.fn();
    // makeFakeMcpBridge() intentionally has no getScreenSize
    const mcpBridge = makeFakeMcpBridge();
    const wsCtx = makeFakeWsCtx();
    const store = makeFakeStore();
    const exit = startModeB({
      store, wsCtx, httpSrv: {}, projectRoot, scenarioId: 's',
      platform: 'android', appPackage: 'com.example.app',
      deps: { mcpBridge, pollIntervalMs: 9999, spawn },
    });
    await wait(20);
    expect(spawn).not.toHaveBeenCalled();
    wsCtx._simulateMessage({ type: 'save' });
    await exit;
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
});
