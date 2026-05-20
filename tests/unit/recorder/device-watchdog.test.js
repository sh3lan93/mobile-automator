'use strict';

const { DeviceWatchdog } = require('../../../tools/recorder/src/failure/device-watchdog');

function makeFakeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => { t += ms; },
    set: (ms) => { t = ms; },
  };
}

describe('DeviceWatchdog', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('3 consecutive failures within 5s fires onTrip exactly once with deviceLabel and reason', () => {
    const clock = makeFakeClock();
    const onTrip = jest.fn();
    const wd = new DeviceWatchdog({
      onTrip,
      deviceLabel: 'emulator-5554',
      windowMs: 5000,
      threshold: 3,
      now: clock.now,
    });

    wd.observeFailure(new Error('boom 1'));
    clock.advance(1000);
    wd.observeFailure(new Error('boom 2'));
    clock.advance(1000);
    wd.observeFailure(new Error('boom 3'));

    expect(onTrip).toHaveBeenCalledTimes(1);
    const call = onTrip.mock.calls[0][0];
    expect(call.deviceLabel).toBe('emulator-5554');
    expect(typeof call.reason).toBe('string');
    expect(call.reason.length).toBeGreaterThan(0);
  });

  test('2 failures within 5s does not fire onTrip', () => {
    const clock = makeFakeClock();
    const onTrip = jest.fn();
    const wd = new DeviceWatchdog({
      onTrip,
      deviceLabel: 'emulator-5554',
      windowMs: 5000,
      threshold: 3,
      now: clock.now,
    });

    wd.observeFailure(new Error('boom 1'));
    clock.advance(1000);
    wd.observeFailure(new Error('boom 2'));

    expect(onTrip).not.toHaveBeenCalled();
  });

  test('3 failures spread over more than 5s does not fire (rolling window ages out)', () => {
    const clock = makeFakeClock();
    const onTrip = jest.fn();
    const wd = new DeviceWatchdog({
      onTrip,
      deviceLabel: 'emulator-5554',
      windowMs: 5000,
      threshold: 3,
      now: clock.now,
    });

    wd.observeFailure(new Error('boom 1'));
    clock.advance(3000); // t = +3s
    wd.observeFailure(new Error('boom 2'));
    clock.advance(3000); // t = +6s; first failure is now older than 5s window
    wd.observeFailure(new Error('boom 3'));

    expect(onTrip).not.toHaveBeenCalled();
  });

  test('observeSuccess() after 2 failures resets buffer; single new failure does not trip', () => {
    const clock = makeFakeClock();
    const onTrip = jest.fn();
    const wd = new DeviceWatchdog({
      onTrip,
      deviceLabel: 'emulator-5554',
      windowMs: 5000,
      threshold: 3,
      now: clock.now,
    });

    wd.observeFailure(new Error('boom 1'));
    clock.advance(500);
    wd.observeFailure(new Error('boom 2'));
    clock.advance(500);
    wd.observeSuccess();

    clock.advance(500);
    wd.observeFailure(new Error('lonely failure'));
    expect(onTrip).not.toHaveBeenCalled();
  });

  test('after observeSuccess resets buffer, 3 fresh failures within 5s trip the watchdog', () => {
    const clock = makeFakeClock();
    const onTrip = jest.fn();
    const wd = new DeviceWatchdog({
      onTrip,
      deviceLabel: 'emulator-5554',
      windowMs: 5000,
      threshold: 3,
      now: clock.now,
    });

    wd.observeFailure(new Error('boom 1'));
    clock.advance(500);
    wd.observeFailure(new Error('boom 2'));
    clock.advance(500);
    wd.observeSuccess();

    clock.advance(500);
    wd.observeFailure(new Error('fresh 1'));
    clock.advance(500);
    wd.observeFailure(new Error('fresh 2'));
    clock.advance(500);
    wd.observeFailure(new Error('fresh 3'));

    expect(onTrip).toHaveBeenCalledTimes(1);
    expect(onTrip.mock.calls[0][0].deviceLabel).toBe('emulator-5554');
  });

  test('onTrip fires at most once even when many more failures arrive after the trip', () => {
    const clock = makeFakeClock();
    const onTrip = jest.fn();
    const wd = new DeviceWatchdog({
      onTrip,
      deviceLabel: 'emulator-5554',
      windowMs: 5000,
      threshold: 3,
      now: clock.now,
    });

    wd.observeFailure(new Error('boom 1'));
    clock.advance(100);
    wd.observeFailure(new Error('boom 2'));
    clock.advance(100);
    wd.observeFailure(new Error('boom 3'));
    expect(onTrip).toHaveBeenCalledTimes(1);

    // Pile on more failures — should not re-trip.
    for (let i = 0; i < 10; i += 1) {
      clock.advance(100);
      wd.observeFailure(new Error(`extra ${i}`));
    }
    expect(onTrip).toHaveBeenCalledTimes(1);
  });

  test('accepts an injected now() function for deterministic time control', () => {
    // Drive the same scenario twice with two different `now` implementations to
    // confirm timing is driven by `now`, not wall clock or jest timers.
    const fixedClock = makeFakeClock(50_000);
    const onTripA = jest.fn();
    const wdA = new DeviceWatchdog({
      onTrip: onTripA,
      deviceLabel: 'devA',
      windowMs: 5000,
      threshold: 3,
      now: fixedClock.now,
    });

    // All three failures at the exact same timestamp — well within any window.
    wdA.observeFailure(new Error('a'));
    wdA.observeFailure(new Error('b'));
    wdA.observeFailure(new Error('c'));
    expect(onTripA).toHaveBeenCalledTimes(1);

    // Second watchdog: advance the injected clock far enough between calls
    // that no two failures fall in the same window.
    const sparseClock = makeFakeClock(0);
    const onTripB = jest.fn();
    const wdB = new DeviceWatchdog({
      onTrip: onTripB,
      deviceLabel: 'devB',
      windowMs: 5000,
      threshold: 3,
      now: sparseClock.now,
    });

    wdB.observeFailure(new Error('a'));
    sparseClock.advance(10_000);
    wdB.observeFailure(new Error('b'));
    sparseClock.advance(10_000);
    wdB.observeFailure(new Error('c'));
    expect(onTripB).not.toHaveBeenCalled();

    // And jest's real-timer advancement should NOT influence behaviour.
    jest.advanceTimersByTime(60_000);
    expect(onTripA).toHaveBeenCalledTimes(1);
    expect(onTripB).not.toHaveBeenCalled();
  });
});
