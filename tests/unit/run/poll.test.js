'use strict';

const { poll, timeoutFor, POLL_MS, DEFAULT_TIMEOUT_MS } = require('../../../src/run/poll');

// A fake clock: sleep advances time and records the requested duration.
function fakeClock(start = 1000) {
  let t = start;
  const sleeps = [];
  return {
    sleeps,
    now: () => t,
    sleep: async (ms) => { sleeps.push(ms); t += ms; },
  };
}

describe('poll', () => {
  test('constants match the harness', () => {
    expect(POLL_MS).toBe(1500);
    expect(DEFAULT_TIMEOUT_MS).toBe(30000);
  });

  test('returns the first done outcome without sleeping', async () => {
    const clock = fakeClock();
    const probe = jest.fn(async () => ({ done: true, value: 7 }));
    await expect(poll(5000, probe, clock)).resolves.toEqual({ done: true, value: 7 });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(clock.sleeps).toEqual([]);
  });

  test('probes at least once even with a zero timeout', async () => {
    const clock = fakeClock();
    const probe = jest.fn(async () => ({ done: false }));
    await expect(poll(0, probe, clock)).resolves.toEqual({ done: false });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(clock.sleeps).toEqual([]);
  });

  test('sleeps min(POLL_MS, remaining) and probes once more at the deadline', async () => {
    const clock = fakeClock();
    const probe = jest.fn(async () => ({ done: false, n: probe.mock.calls.length }));
    const outcome = await poll(4000, probe, clock);
    expect(clock.sleeps).toEqual([1500, 1500, 1000]);
    expect(probe).toHaveBeenCalledTimes(4);
    expect(outcome).toEqual({ done: false, n: 4 });
  });

  test('stops as soon as the probe reports done', async () => {
    const clock = fakeClock();
    let n = 0;
    const outcome = await poll(30000, async () => ({ done: ++n === 3 }), clock);
    expect(outcome.done).toBe(true);
    expect(clock.sleeps).toEqual([1500, 1500]);
  });
});

describe('timeoutFor', () => {
  test('uses the step wait_config timeout when set', () => {
    expect(timeoutFor({ wait_config: { timeout_ms: 5000 } })).toBe(5000);
  });

  test('defaults when wait_config or its timeout is absent or zero', () => {
    expect(timeoutFor({})).toBe(DEFAULT_TIMEOUT_MS);
    expect(timeoutFor({ wait_config: {} })).toBe(DEFAULT_TIMEOUT_MS);
    expect(timeoutFor({ wait_config: { timeout_ms: 0 } })).toBe(DEFAULT_TIMEOUT_MS);
  });
});
