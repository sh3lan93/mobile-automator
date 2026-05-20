'use strict';

const path = require('path');
const { attachFailureModes } = require('../../../tools/recorder/src/failure/orchestrator');

function makeStore() {
  return {
    cleanupOnCancel: jest.fn(),
    writeCrashLog: jest.fn(({ timestampISO }) => ({
      inBundlePath: `/tmp/in/${timestampISO}.log`,
      persistentPath: `/tmp/persistent/scn-${timestampISO}.log`,
    })),
    appendEvent: jest.fn(),
  };
}

function makeFakeWsCtx() {
  let count = 0;
  const messageHandlers = [];
  const connectHandlers = [];
  const disconnectHandlers = [];
  const broadcasts = [];
  return {
    broadcast: jest.fn((msg) => { broadcasts.push(msg); }),
    onMessage(fn) { messageHandlers.push(fn); },
    onConnect(fn) { connectHandlers.push(fn); },
    onDisconnect(fn) { disconnectHandlers.push(fn); },
    clientCount() { return count; },
    // simulators
    _broadcasts: broadcasts,
    _simulateMessage(msg) {
      for (const h of messageHandlers) h(msg);
    },
    _simulateConnect() {
      count += 1;
      for (const h of connectHandlers) h();
    },
    _simulateDisconnect() {
      count = Math.max(0, count - 1);
      for (const h of disconnectHandlers) h();
    },
  };
}

function makeMcpBridge() {
  return {
    launchApp: jest.fn().mockResolvedValue(undefined),
    getCrash: jest.fn().mockResolvedValue(null),
  };
}

function makePoller() {
  return {
    start: jest.fn(),
    stop: jest.fn(),
  };
}

const FIXED_NOW = new Date('2026-05-20T18:23:09.123Z');

function defaultDeps(overrides = {}) {
  return {
    store: makeStore(),
    wsCtx: makeFakeWsCtx(),
    mcpBridge: makeMcpBridge(),
    hierarchyPoller: makePoller(),
    projectRoot: '/proj',
    scenarioId: 'scn',
    deviceLabel: 'Pixel_6_API_34',
    appPackage: 'com.example.app',
    onDone: jest.fn(),
    logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
    now: () => FIXED_NOW,
    ...overrides,
  };
}

describe('attachFailureModes — orchestrator', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('device disconnect: 3 failures within window trip → broadcast + cleanup + onDone(2)', () => {
    const deps = defaultDeps({
      deviceWatchdogOpts: { windowMs: 5000, threshold: 3, now: () => Date.now() },
    });
    const orch = attachFailureModes(deps);

    // Drive watchdog directly via observeFailure (in real life the poller's onError hook does this).
    orch.deviceWatchdog.observeFailure(new Error('adb pipe broke'));
    orch.deviceWatchdog.observeFailure(new Error('adb pipe broke'));
    orch.deviceWatchdog.observeFailure(new Error('adb pipe broke'));

    // Broadcast
    expect(deps.wsCtx.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'device-disconnected',
        device_label: 'Pixel_6_API_34',
      })
    );
    const call = deps.wsCtx.broadcast.mock.calls.find(
      (c) => c[0] && c[0].type === 'device-disconnected'
    );
    expect(call[0].reason).toEqual(expect.any(String));

    // Poller stopped
    expect(deps.hierarchyPoller.stop).toHaveBeenCalled();

    // Artifacts cleaned
    expect(deps.store.cleanupOnCancel).toHaveBeenCalled();

    // Operator log line
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("device 'Pixel_6_API_34' disconnected")
    );

    // onDone called with exit code 2
    expect(deps.onDone).toHaveBeenCalledWith(2);
  });

  test('device disconnect: stops crash + browser watchdogs', async () => {
    const deps = defaultDeps();
    const orch = attachFailureModes(deps);

    // Trip device. Crash watchdog must stop polling thereafter.
    orch.deviceWatchdog.observeFailure(new Error('x'));
    orch.deviceWatchdog.observeFailure(new Error('x'));
    orch.deviceWatchdog.observeFailure(new Error('x'));

    const callsBefore = deps.mcpBridge.getCrash.mock.calls.length;
    await jest.advanceTimersByTimeAsync(60000);
    expect(deps.mcpBridge.getCrash.mock.calls.length).toBe(callsBefore);

    // browser watchdog: even after disconnect cycle, timeout must not fire.
    deps.wsCtx._simulateConnect();
    deps.wsCtx._simulateDisconnect();
    await jest.advanceTimersByTimeAsync(120000);

    // onDone should have fired exactly once (from device disconnect, with 2).
    expect(deps.onDone).toHaveBeenCalledTimes(1);
    expect(deps.onDone).toHaveBeenCalledWith(2);
  });

  test('crash → relaunch: writeCrashLog, broadcast, await ws choice, launchApp, appendEvent, resume poller', async () => {
    const deps = defaultDeps();
    const orch = attachFailureModes(deps);

    // Drive crash detection. Set bridge.getCrash to return a payload, run a poll tick.
    const crash = { log: 'NullPointerException at com.example.foo' };
    deps.mcpBridge.getCrash.mockResolvedValueOnce(crash);
    await jest.advanceTimersByTimeAsync(5000); // crash watchdog default intervalMs
    await Promise.resolve(); // flush microtasks for the _poll await

    const expectedTs = '2026-05-20T18-23-09-123Z';
    expect(deps.store.writeCrashLog).toHaveBeenCalledWith(
      expect.objectContaining({
        timestampISO: expectedTs,
        body: crash.log,
        persistentRoot: path.join('/proj', 'mobile-automator', 'crash-logs'),
      })
    );

    const crashBroadcast = deps.wsCtx.broadcast.mock.calls
      .map((c) => c[0])
      .find((m) => m && m.type === 'app-crashed');
    expect(crashBroadcast).toBeDefined();
    expect(crashBroadcast.log_path).toBe(`/tmp/persistent/scn-${expectedTs}.log`);
    expect(crashBroadcast.in_bundle_log_path).toBe(`/tmp/in/${expectedTs}.log`);

    expect(deps.hierarchyPoller.stop).toHaveBeenCalled();

    // Now simulate the user's WS choice: relaunch
    deps.wsCtx._simulateMessage({ type: 'crash-choice', choice: 'relaunch' });
    // The orchestrator awaits launchApp — give it a microtask round to settle.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(deps.mcpBridge.launchApp).toHaveBeenCalledWith('com.example.app');
    expect(deps.store.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'launch_app',
        app_package: 'com.example.app',
        expected_state: expect.stringContaining(`scn-${expectedTs}.log`),
      })
    );
    expect(deps.hierarchyPoller.start).toHaveBeenCalled();
    expect(
      deps.wsCtx.broadcast.mock.calls.map((c) => c[0]).some((m) => m && m.type === 'app-relaunched')
    ).toBe(true);
    expect(deps.onDone).not.toHaveBeenCalled();
  });

  test('crash → relaunch: after resume, a new crash payload fires onCrash again', async () => {
    const deps = defaultDeps();
    const orch = attachFailureModes(deps);

    const crash1 = { log: 'first' };
    const crash2 = { log: 'second' };
    deps.mcpBridge.getCrash.mockResolvedValueOnce(crash1);
    await jest.advanceTimersByTimeAsync(5000);
    await Promise.resolve();

    expect(deps.store.writeCrashLog).toHaveBeenCalledTimes(1);

    deps.wsCtx._simulateMessage({ type: 'crash-choice', choice: 'relaunch' });
    await Promise.resolve();
    await Promise.resolve();

    // Now resumed; a second crash should be detected.
    deps.mcpBridge.getCrash.mockResolvedValueOnce(crash2);
    await jest.advanceTimersByTimeAsync(5000);
    await Promise.resolve();

    expect(deps.store.writeCrashLog).toHaveBeenCalledTimes(2);

    orch.stopAll();
  });

  test('crash → save: broadcast save-partial-ready, onDone NOT called, launchApp NOT called', async () => {
    const deps = defaultDeps();
    attachFailureModes(deps);

    deps.mcpBridge.getCrash.mockResolvedValueOnce({ log: 'boom' });
    await jest.advanceTimersByTimeAsync(5000);
    await Promise.resolve();

    deps.wsCtx._simulateMessage({ type: 'crash-choice', choice: 'save' });
    await Promise.resolve();

    expect(
      deps.wsCtx.broadcast.mock.calls.map((c) => c[0]).some((m) => m && m.type === 'save-partial-ready')
    ).toBe(true);
    expect(deps.mcpBridge.launchApp).not.toHaveBeenCalled();
    expect(deps.onDone).not.toHaveBeenCalled();
  });

  test('crash → discard: store.cleanupOnCancel + onDone(130), no launchApp', async () => {
    const deps = defaultDeps();
    attachFailureModes(deps);

    deps.mcpBridge.getCrash.mockResolvedValueOnce({ log: 'boom' });
    await jest.advanceTimersByTimeAsync(5000);
    await Promise.resolve();

    deps.wsCtx._simulateMessage({ type: 'crash-choice', choice: 'discard' });
    await Promise.resolve();

    expect(deps.store.cleanupOnCancel).toHaveBeenCalled();
    expect(deps.onDone).toHaveBeenCalledWith(130);
    expect(deps.mcpBridge.launchApp).not.toHaveBeenCalled();
  });

  test('crash → relaunch where launchApp rejects: broadcast app-relaunch-failed, fall through to discard', async () => {
    const deps = defaultDeps();
    deps.mcpBridge.launchApp.mockRejectedValueOnce(new Error('adb timeout'));
    attachFailureModes(deps);

    deps.mcpBridge.getCrash.mockResolvedValueOnce({ log: 'boom' });
    await jest.advanceTimersByTimeAsync(5000);
    await Promise.resolve();

    deps.wsCtx._simulateMessage({ type: 'crash-choice', choice: 'relaunch' });
    // Flush several microtasks so the rejected launchApp resolves.
    for (let i = 0; i < 5; i++) await Promise.resolve();

    const failedBroadcast = deps.wsCtx.broadcast.mock.calls
      .map((c) => c[0])
      .find((m) => m && m.type === 'app-relaunch-failed');
    expect(failedBroadcast).toBeDefined();
    expect(failedBroadcast.error).toEqual(expect.stringContaining('adb timeout'));

    // No successful launch_app event appended.
    const launchAppEvents = deps.store.appendEvent.mock.calls
      .map((c) => c[0])
      .filter((e) => e && e.kind === 'launch_app');
    expect(launchAppEvents).toHaveLength(0);

    // Treated as discard: cleanup + onDone(130).
    expect(deps.store.cleanupOnCancel).toHaveBeenCalled();
    expect(deps.onDone).toHaveBeenCalledWith(130);
  });

  test('browser timeout: disconnect + 60s elapses → cleanup + onDone(130)', async () => {
    const deps = defaultDeps();
    attachFailureModes(deps);

    deps.wsCtx._simulateConnect();
    deps.wsCtx._simulateDisconnect();
    await jest.advanceTimersByTimeAsync(60000);

    expect(deps.store.cleanupOnCancel).toHaveBeenCalled();
    expect(deps.hierarchyPoller.stop).toHaveBeenCalled();
    expect(deps.onDone).toHaveBeenCalledWith(130);
  });

  test('browser timeout: stops crash watchdog', async () => {
    const deps = defaultDeps();
    attachFailureModes(deps);

    deps.wsCtx._simulateConnect();
    deps.wsCtx._simulateDisconnect();
    await jest.advanceTimersByTimeAsync(60000);

    const callsAfterTimeout = deps.mcpBridge.getCrash.mock.calls.length;
    await jest.advanceTimersByTimeAsync(30000);
    expect(deps.mcpBridge.getCrash.mock.calls.length).toBe(callsAfterTimeout);
  });

  test('multiple crash-choice messages after the first are ignored', async () => {
    const deps = defaultDeps();
    attachFailureModes(deps);

    deps.mcpBridge.getCrash.mockResolvedValueOnce({ log: 'boom' });
    await jest.advanceTimersByTimeAsync(5000);
    await Promise.resolve();

    // First choice: save (terminal, no onDone).
    deps.wsCtx._simulateMessage({ type: 'crash-choice', choice: 'save' });
    await Promise.resolve();
    // Second choice: discard — must be ignored.
    deps.wsCtx._simulateMessage({ type: 'crash-choice', choice: 'discard' });
    await Promise.resolve();

    expect(deps.onDone).not.toHaveBeenCalled();
    // cleanupOnCancel must NOT have been called from the discard branch.
    expect(deps.store.cleanupOnCancel).not.toHaveBeenCalled();
  });

  test('non crash-choice ws messages are ignored', async () => {
    const deps = defaultDeps();
    attachFailureModes(deps);

    deps.mcpBridge.getCrash.mockResolvedValueOnce({ log: 'boom' });
    await jest.advanceTimersByTimeAsync(5000);
    await Promise.resolve();

    deps.wsCtx._simulateMessage({ type: 'ping' });
    deps.wsCtx._simulateMessage({ foo: 'bar' });
    await Promise.resolve();

    // Still awaiting a real choice → no follow-on broadcasts beyond app-crashed.
    expect(deps.mcpBridge.launchApp).not.toHaveBeenCalled();
    expect(deps.onDone).not.toHaveBeenCalled();
  });

  test('stopAll() halts crash and browser watchdog timers', async () => {
    const deps = defaultDeps();
    const orch = attachFailureModes(deps);

    orch.stopAll();

    const callsBefore = deps.mcpBridge.getCrash.mock.calls.length;
    await jest.advanceTimersByTimeAsync(60000);
    expect(deps.mcpBridge.getCrash.mock.calls.length).toBe(callsBefore);

    // Browser disconnect after stopAll should not fire onDone.
    deps.wsCtx._simulateConnect();
    deps.wsCtx._simulateDisconnect();
    await jest.advanceTimersByTimeAsync(120000);
    expect(deps.onDone).not.toHaveBeenCalled();
  });

  test('returned object exposes the three watchdogs', () => {
    const deps = defaultDeps();
    const orch = attachFailureModes(deps);
    expect(orch.deviceWatchdog).toBeDefined();
    expect(orch.crashWatchdog).toBeDefined();
    expect(orch.browserWatchdog).toBeDefined();
    expect(typeof orch.stopAll).toBe('function');
    orch.stopAll();
  });
});
