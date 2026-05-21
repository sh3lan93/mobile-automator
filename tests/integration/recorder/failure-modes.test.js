'use strict';

// Integration test for slice #10 (issue #31) — failure-mode orchestrator.
//
// Drives the real `attachFailureModes` against a real `ArtifactsStore` writing
// to a tmpdir, with fake `McpBridge`, fake `hierarchyPoller`, and a synthetic
// `wsCtx` whose surface mirrors `tools/recorder/src/server/ws-protocol.js`.
// The live `index.js` lifecycle that will host this orchestrator hasn't
// landed yet; the integration coverage exercised here is the highest-fidelity
// shape slice #10 supports — by design it matches what the eventual real
// lifecycle will plumb together.
//
// AC9 scenarios covered:
//   1. Device disconnect — 3 failures in 5s → broadcast + cleanup + onDone(2).
//   2. App crash → relaunch — log dual-written, app-crashed broadcast, then
//      crash-choice: relaunch triggers launchApp + a launch_app event with
//      expected_state referencing the persistent log basename.
//   3. App crash → save partial — bundle preserved, save-partial-ready broadcast.
//   4. App crash → discard — bundle nuked but persistent log survives, onDone(130).
//   5. Browser disconnect — 60s timeout → cleanup + onDone(130).

const fs = require('fs');
const path = require('path');
const os = require('os');

const { ArtifactsStore } = require('../../../tools/recorder/src/artifacts');
const { attachFailureModes } = require('../../../tools/recorder/src/failure/orchestrator');

function makeFakeWsCtx() {
  const broadcasts = [];
  const msgHandlers = [];
  const connectHandlers = [];
  const disconnectHandlers = [];
  let clientCount = 1; // assume browser is connected at construction

  return {
    broadcast(m) { broadcasts.push(m); },
    onMessage(fn) { msgHandlers.push(fn); },
    onConnect(fn) { connectHandlers.push(fn); },
    onDisconnect(fn) { disconnectHandlers.push(fn); },
    clientCount() { return clientCount; },
    _broadcasts: broadcasts,
    _simulateClientMessage(m) { msgHandlers.forEach((h) => h(m)); },
    _simulateDisconnect() {
      clientCount = 0;
      disconnectHandlers.forEach((h) => h());
    },
    _simulateConnect() {
      clientCount = 1;
      connectHandlers.forEach((h) => h());
    },
  };
}

function findBroadcast(wsCtx, type) {
  return wsCtx._broadcasts.find((b) => b && b.type === type);
}

function readEventsJsonl(bundleRoot) {
  const eventsPath = path.join(bundleRoot, 'events.jsonl');
  if (!fs.existsSync(eventsPath)) return [];
  return fs
    .readFileSync(eventsPath, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

describe('failure-modes integration', () => {
  let tmp;
  let projectRoot;
  const scenarioId = 'demo_scenario';
  let bundleRoot;
  let persistentRoot;
  let store;
  let wsCtx;
  let mcpBridge;
  let hierarchyPoller;
  let onDone;
  let orch;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-failure-'));
    projectRoot = tmp;
    bundleRoot = path.join(tmp, 'mobile-automator', '.recorder', scenarioId);
    persistentRoot = path.join(tmp, 'mobile-automator', 'crash-logs');

    fs.mkdirSync(path.join(tmp, 'mobile-automator'), { recursive: true });
    store = new ArtifactsStore({ projectRoot, scenarioId });
    store.init({ mode: 'platform-aware', scenario_id: scenarioId });

    wsCtx = makeFakeWsCtx();
    mcpBridge = {
      getCrash: jest.fn().mockResolvedValue(null),
      launchApp: jest.fn().mockResolvedValue({ ok: true }),
    };
    hierarchyPoller = { start: jest.fn(), stop: jest.fn() };
    onDone = jest.fn();

    jest.useFakeTimers();
    orch = attachFailureModes({
      store,
      wsCtx,
      mcpBridge,
      hierarchyPoller,
      projectRoot,
      scenarioId,
      deviceLabel: 'emulator-5554',
      appPackage: 'com.example.demo',
      onDone,
      // Silence the orchestrator's expected error log (AC2: "prints a clear
      // error including the device label") to keep jest output clean. The
      // unit tests assert the logger.error call shape.
      logger: { error: () => {}, warn: () => {} },
      crashWatchdogOpts: { intervalMs: 5000 },
      browserWatchdogOpts: { timeoutMs: 60000 },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    try { orch.stopAll(); } catch (_e) { /* swallow */ }
    if (tmp && fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('device disconnect: 3 failures within 5s → broadcast + cleanup + onDone(2)', () => {
    expect(fs.existsSync(bundleRoot)).toBe(true);

    // Drive three observe-failure calls — DeviceWatchdog defaults to threshold
    // 3 within a 5000ms window. The orchestrator constructs the watchdog with
    // a default now=Date.now, but we don't need to advance fake timers since
    // the three calls are synchronous and resolve well inside any window.
    const err = new Error('mcp call rejected: device gone');
    orch.deviceWatchdog.observeFailure(err);
    orch.deviceWatchdog.observeFailure(err);
    orch.deviceWatchdog.observeFailure(err);

    const bcast = findBroadcast(wsCtx, 'device-disconnected');
    expect(bcast).toBeDefined();
    expect(bcast.device_label).toBe('emulator-5554');
    expect(typeof bcast.reason).toBe('string');
    expect(bcast.reason.length).toBeGreaterThan(0);

    expect(hierarchyPoller.stop).toHaveBeenCalled();
    expect(fs.existsSync(bundleRoot)).toBe(false);
    expect(onDone).toHaveBeenCalledWith(2);
  });

  test('app crash → relaunch: dual-write log + launch_app event with expected_state', async () => {
    const crashLog = 'java.lang.NullPointerException at com.example.demo.MainActivity.onCreate(MainActivity.kt:42)';
    // First poll surfaces a crash; subsequent polls return null so the watchdog
    // doesn't re-fire mid-test.
    mcpBridge.getCrash.mockResolvedValueOnce({ log: crashLog });

    await jest.advanceTimersByTimeAsync(5000);

    // Persistent path under mobile-automator/crash-logs/ — used by the discard
    // assertion below as well.
    expect(fs.existsSync(persistentRoot)).toBe(true);
    const persistentFiles = fs.readdirSync(persistentRoot);
    expect(persistentFiles).toHaveLength(1);
    const persistentFile = path.join(persistentRoot, persistentFiles[0]);
    expect(persistentFiles[0]).toMatch(/^demo_scenario-/);
    expect(persistentFiles[0]).toMatch(/\.log$/);
    expect(fs.readFileSync(persistentFile, 'utf8')).toBe(crashLog);

    const bundleCrashesDir = path.join(bundleRoot, 'crashes');
    expect(fs.existsSync(bundleCrashesDir)).toBe(true);
    const bundleCrashFiles = fs.readdirSync(bundleCrashesDir);
    expect(bundleCrashFiles).toHaveLength(1);
    expect(fs.readFileSync(path.join(bundleCrashesDir, bundleCrashFiles[0]), 'utf8')).toBe(crashLog);

    const crashedBcast = findBroadcast(wsCtx, 'app-crashed');
    expect(crashedBcast).toBeDefined();
    expect(crashedBcast.log_path).toBe(persistentFile);
    expect(hierarchyPoller.stop).toHaveBeenCalled();

    // User picks relaunch.
    wsCtx._simulateClientMessage({ type: 'crash-choice', choice: 'relaunch' });
    // launchApp is async — let the microtask queue flush.
    await Promise.resolve();
    await Promise.resolve();

    expect(mcpBridge.launchApp).toHaveBeenCalledWith('com.example.demo');
    expect(findBroadcast(wsCtx, 'app-relaunched')).toBeDefined();
    expect(hierarchyPoller.start).toHaveBeenCalled();

    const events = readEventsJsonl(bundleRoot);
    const launchEvent = events.find((e) => e.kind === 'launch_app');
    expect(launchEvent).toBeDefined();
    expect(launchEvent.app_package).toBe('com.example.demo');
    expect(launchEvent.expected_state).toContain(path.basename(persistentFile));
    expect(launchEvent.expected_state).toContain('crash-logs/');

    expect(onDone).not.toHaveBeenCalled();
  });

  test('app crash → save partial: bundle preserved, save-partial-ready broadcast, no onDone', async () => {
    mcpBridge.getCrash.mockResolvedValueOnce({ log: 'segfault' });
    await jest.advanceTimersByTimeAsync(5000);

    const persistentBefore = fs.readdirSync(persistentRoot);
    expect(persistentBefore).toHaveLength(1);
    const bundleCrashesDir = path.join(bundleRoot, 'crashes');
    expect(fs.readdirSync(bundleCrashesDir)).toHaveLength(1);

    wsCtx._simulateClientMessage({ type: 'crash-choice', choice: 'save' });
    await Promise.resolve();

    // Bundle still intact — save flow elsewhere will run normal close-out.
    expect(fs.existsSync(bundleRoot)).toBe(true);
    expect(fs.existsSync(path.join(bundleCrashesDir, fs.readdirSync(bundleCrashesDir)[0]))).toBe(true);
    expect(fs.existsSync(path.join(persistentRoot, persistentBefore[0]))).toBe(true);

    expect(findBroadcast(wsCtx, 'save-partial-ready')).toBeDefined();
    expect(mcpBridge.launchApp).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  test('app crash → discard: bundle gone but persistent log survives, onDone(130)', async () => {
    mcpBridge.getCrash.mockResolvedValueOnce({ log: 'OOM killer' });
    await jest.advanceTimersByTimeAsync(5000);

    const persistentBefore = fs.readdirSync(persistentRoot);
    expect(persistentBefore).toHaveLength(1);
    const persistentFile = path.join(persistentRoot, persistentBefore[0]);

    wsCtx._simulateClientMessage({ type: 'crash-choice', choice: 'discard' });
    await Promise.resolve();

    expect(fs.existsSync(bundleRoot)).toBe(false);
    expect(fs.existsSync(persistentFile)).toBe(true);
    expect(fs.readFileSync(persistentFile, 'utf8')).toBe('OOM killer');
    expect(mcpBridge.launchApp).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith(130);
  });

  test('browser disconnect: 60s timeout → cleanup + onDone(130)', () => {
    expect(fs.existsSync(bundleRoot)).toBe(true);

    wsCtx._simulateDisconnect();
    // Advance the fake clock past the BrowserWatchdog's 60s reconnect window.
    jest.advanceTimersByTime(60000);

    expect(fs.existsSync(bundleRoot)).toBe(false);
    expect(hierarchyPoller.stop).toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith(130);
  });
});
