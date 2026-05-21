'use strict';

const { BrowserWatchdog } = require('../../../tools/recorder/src/failure/browser-watchdog');

function makeFakeWsCtx() {
  let count = 0;
  const connectHandlers = [];
  const disconnectHandlers = [];
  return {
    clientCount() { return count; },
    onConnect(fn) { connectHandlers.push(fn); },
    onDisconnect(fn) { disconnectHandlers.push(fn); },
    // simulators
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

describe('BrowserWatchdog', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('does not call onTimeout if no client ever connects', () => {
    const wsCtx = makeFakeWsCtx();
    const onTimeout = jest.fn();
    const wd = new BrowserWatchdog({ wsCtx, onTimeout });
    wd.start();
    jest.advanceTimersByTime(120000);
    expect(onTimeout).not.toHaveBeenCalled();
    wd.stop();
  });

  test('after connect→disconnect, advancing 60s fires onTimeout exactly once', () => {
    const wsCtx = makeFakeWsCtx();
    const onTimeout = jest.fn();
    const wd = new BrowserWatchdog({ wsCtx, onTimeout });
    wd.start();
    wsCtx._simulateConnect();
    wsCtx._simulateDisconnect();
    jest.advanceTimersByTime(60000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  test('reconnect within 30s cancels the timer', () => {
    const wsCtx = makeFakeWsCtx();
    const onTimeout = jest.fn();
    const wd = new BrowserWatchdog({ wsCtx, onTimeout });
    wd.start();
    wsCtx._simulateConnect();
    wsCtx._simulateDisconnect();
    jest.advanceTimersByTime(30000);
    wsCtx._simulateConnect();
    jest.advanceTimersByTime(60000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  test('stop() clears any pending timer', () => {
    const wsCtx = makeFakeWsCtx();
    const onTimeout = jest.fn();
    const wd = new BrowserWatchdog({ wsCtx, onTimeout });
    wd.start();
    wsCtx._simulateConnect();
    wsCtx._simulateDisconnect();
    jest.advanceTimersByTime(10000);
    wd.stop();
    jest.advanceTimersByTime(60000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  test('onTimeout fires at most once across multiple cycles', () => {
    const wsCtx = makeFakeWsCtx();
    const onTimeout = jest.fn();
    const wd = new BrowserWatchdog({ wsCtx, onTimeout });
    wd.start();
    // First cycle: connect, disconnect, timer fires
    wsCtx._simulateConnect();
    wsCtx._simulateDisconnect();
    jest.advanceTimersByTime(60000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    // After timeout fired, simulate reconnect/disconnect cycle and another timer
    wsCtx._simulateConnect();
    wsCtx._simulateDisconnect();
    jest.advanceTimersByTime(60000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    wd.stop();
  });
});
