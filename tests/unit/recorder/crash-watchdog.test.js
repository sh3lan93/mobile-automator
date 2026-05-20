'use strict';

const { CrashWatchdog } = require('../../../tools/recorder/src/failure/crash-watchdog');

function makeBridge(getCrashImpl) {
  return {
    getCrash: jest.fn(getCrashImpl),
  };
}

describe('CrashWatchdog', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('after start(), bridge.getCrash() is called once per intervalMs tick', async () => {
    const bridge = makeBridge(async () => null);
    const onCrash = jest.fn();
    const wd = new CrashWatchdog({ bridge, onCrash, intervalMs: 5000 });
    wd.start();
    expect(bridge.getCrash).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(5000);
    expect(bridge.getCrash).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(5000);
    expect(bridge.getCrash).toHaveBeenCalledTimes(2);

    wd.stop();
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['empty object', {}],
    ['object without log field', { foo: 'bar' }],
    ['object with empty log', { log: '' }],
  ])('does not fire onCrash when getCrash returns %s', async (_label, payload) => {
    const bridge = makeBridge(async () => payload);
    const onCrash = jest.fn();
    const wd = new CrashWatchdog({ bridge, onCrash, intervalMs: 5000 });
    wd.start();

    await jest.advanceTimersByTimeAsync(5000);
    await jest.advanceTimersByTimeAsync(5000);

    expect(onCrash).not.toHaveBeenCalled();
    wd.stop();
  });

  test('fires onCrash exactly once with the crash payload when getCrash returns { log }', async () => {
    const payload = { log: 'NullPointerException at com.example.foo' };
    const bridge = makeBridge(async () => payload);
    const onCrash = jest.fn();
    const wd = new CrashWatchdog({ bridge, onCrash, intervalMs: 5000 });
    wd.start();

    await jest.advanceTimersByTimeAsync(5000);

    expect(onCrash).toHaveBeenCalledTimes(1);
    expect(onCrash).toHaveBeenCalledWith({ crash: payload });
    wd.stop();
  });

  test('does not re-fire onCrash on subsequent ticks while parked', async () => {
    const payload = { log: 'boom' };
    const bridge = makeBridge(async () => payload);
    const onCrash = jest.fn();
    const wd = new CrashWatchdog({ bridge, onCrash, intervalMs: 5000 });
    wd.start();

    await jest.advanceTimersByTimeAsync(5000);
    expect(onCrash).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(5000);
    await jest.advanceTimersByTimeAsync(5000);

    expect(onCrash).toHaveBeenCalledTimes(1);
    wd.stop();
  });

  test('after resume(), a fresh crash payload triggers onCrash again', async () => {
    const payload1 = { log: 'first crash' };
    const payload2 = { log: 'second crash' };
    let current = payload1;
    const bridge = makeBridge(async () => current);
    const onCrash = jest.fn();
    const wd = new CrashWatchdog({ bridge, onCrash, intervalMs: 5000 });
    wd.start();

    await jest.advanceTimersByTimeAsync(5000);
    expect(onCrash).toHaveBeenCalledTimes(1);
    expect(onCrash).toHaveBeenLastCalledWith({ crash: payload1 });

    // While parked, subsequent ticks should not fire even if payload changes.
    current = payload2;
    await jest.advanceTimersByTimeAsync(5000);
    expect(onCrash).toHaveBeenCalledTimes(1);

    wd.resume();
    await jest.advanceTimersByTimeAsync(5000);
    expect(onCrash).toHaveBeenCalledTimes(2);
    expect(onCrash).toHaveBeenLastCalledWith({ crash: payload2 });

    wd.stop();
  });

  test('stop() clears the interval — no further getCrash() calls after stop', async () => {
    const bridge = makeBridge(async () => null);
    const onCrash = jest.fn();
    const wd = new CrashWatchdog({ bridge, onCrash, intervalMs: 5000 });
    wd.start();

    await jest.advanceTimersByTimeAsync(5000);
    expect(bridge.getCrash).toHaveBeenCalledTimes(1);

    wd.stop();
    const callsAtStop = bridge.getCrash.mock.calls.length;

    await jest.advanceTimersByTimeAsync(60000);
    expect(bridge.getCrash).toHaveBeenCalledTimes(callsAtStop);
    expect(onCrash).not.toHaveBeenCalled();
  });

  test('swallows rejections from getCrash() and keeps polling', async () => {
    let mode = 'reject';
    const bridge = makeBridge(async () => {
      if (mode === 'reject') throw new Error('adb pipe broke');
      if (mode === 'null') return null;
      return { log: 'real crash after recovery' };
    });
    const onCrash = jest.fn();
    const wd = new CrashWatchdog({ bridge, onCrash, intervalMs: 5000 });
    wd.start();

    await jest.advanceTimersByTimeAsync(5000);
    expect(bridge.getCrash).toHaveBeenCalledTimes(1);
    expect(onCrash).not.toHaveBeenCalled();

    mode = 'null';
    await jest.advanceTimersByTimeAsync(5000);
    expect(bridge.getCrash).toHaveBeenCalledTimes(2);
    expect(onCrash).not.toHaveBeenCalled();

    mode = 'crash';
    await jest.advanceTimersByTimeAsync(5000);
    expect(bridge.getCrash).toHaveBeenCalledTimes(3);
    expect(onCrash).toHaveBeenCalledTimes(1);
    expect(onCrash).toHaveBeenCalledWith({ crash: { log: 'real crash after recovery' } });

    wd.stop();
  });

  test('continues functioning if onCrash callback throws', async () => {
    const payload1 = { log: 'crash one' };
    const payload2 = { log: 'crash two' };
    let current = payload1;
    const bridge = makeBridge(async () => current);
    const onCrash = jest.fn(() => {
      throw new Error('handler exploded');
    });
    const wd = new CrashWatchdog({ bridge, onCrash, intervalMs: 5000 });
    wd.start();

    await jest.advanceTimersByTimeAsync(5000);
    expect(onCrash).toHaveBeenCalledTimes(1);

    // After a throwing onCrash, the watchdog is still parked.
    await jest.advanceTimersByTimeAsync(5000);
    expect(onCrash).toHaveBeenCalledTimes(1);

    // resume + new payload — onCrash should fire (and throw) again without
    // taking the watchdog down.
    wd.resume();
    current = payload2;
    await jest.advanceTimersByTimeAsync(5000);
    expect(onCrash).toHaveBeenCalledTimes(2);

    wd.stop();
  });

  test('start() is idempotent — calling twice does not double-arm the interval', async () => {
    const bridge = makeBridge(async () => null);
    const onCrash = jest.fn();
    const wd = new CrashWatchdog({ bridge, onCrash, intervalMs: 5000 });
    wd.start();
    wd.start();

    await jest.advanceTimersByTimeAsync(5000);
    expect(bridge.getCrash).toHaveBeenCalledTimes(1);

    wd.stop();
  });
});
