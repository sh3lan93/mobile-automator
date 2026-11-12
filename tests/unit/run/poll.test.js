'use strict';

const { poll, timeoutFor, makePollUntil } = require('../../../src/run/poll');
const { runSettings } = require('../../../src/run/settings');

const POLL_MS = 1500;
const DEFAULT_TIMEOUT_MS = 30000;
const SETTINGS = runSettings(null);

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
  test('returns the first done outcome without sleeping', async () => {
    const clock = fakeClock();
    const probe = jest.fn(async () => ({ done: true, value: 7 }));
    await expect(poll(5000, probe, clock, POLL_MS)).resolves.toEqual({ done: true, value: 7 });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(clock.sleeps).toEqual([]);
  });

  test('probes at least once even with a zero timeout', async () => {
    const clock = fakeClock();
    const probe = jest.fn(async () => ({ done: false }));
    await expect(poll(0, probe, clock, POLL_MS)).resolves.toEqual({ done: false });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(clock.sleeps).toEqual([]);
  });

  test('sleeps min(POLL_MS, remaining) and probes once more at the deadline', async () => {
    const clock = fakeClock();
    const probe = jest.fn(async () => ({ done: false, n: probe.mock.calls.length }));
    const outcome = await poll(4000, probe, clock, POLL_MS);
    expect(clock.sleeps).toEqual([1500, 1500, 1000]);
    expect(probe).toHaveBeenCalledTimes(4);
    expect(outcome).toEqual({ done: false, n: 4 });
  });

  test('stops as soon as the probe reports done', async () => {
    const clock = fakeClock();
    let n = 0;
    const outcome = await poll(30000, async () => ({ done: ++n === 3 }), clock, POLL_MS);
    expect(outcome.done).toBe(true);
    expect(clock.sleeps).toEqual([1500, 1500]);
  });
});

describe('timeoutFor', () => {
  test('uses the step wait_config timeout when set', () => {
    expect(timeoutFor({ wait_config: { timeout_ms: 5000 } }, SETTINGS)).toBe(5000);
  });

  test('defaults when wait_config or its timeout is absent or zero', () => {
    expect(timeoutFor({}, SETTINGS)).toBe(DEFAULT_TIMEOUT_MS);
    expect(timeoutFor({ wait_config: {} }, SETTINGS)).toBe(DEFAULT_TIMEOUT_MS);
    expect(timeoutFor({ wait_config: { timeout_ms: 0 } }, SETTINGS)).toBe(DEFAULT_TIMEOUT_MS);
  });
});

describe('makePollUntil', () => {
  test('polls on the step budget and the run pollMs, returning the budget used', async () => {
    const clock = fakeClock();
    const pollUntil = makePollUntil({ ...SETTINGS, pollMs: 500, defaultTimeoutMs: 1200 }, clock);
    const probe = jest.fn(async () => ({ done: false }));
    const r = await pollUntil({}, probe);
    expect(r).toEqual({ outcome: { done: false }, timeoutMs: 1200 });
    expect(clock.sleeps).toEqual([500, 500, 200]);
  });

  test('honours the step timeout and the --timeout-ms cap', async () => {
    const pollUntil = makePollUntil({ ...SETTINGS, timeoutCapMs: 700 }, fakeClock());
    const r = await pollUntil({ wait_config: { timeout_ms: 5000 } }, async () => ({ done: true }));
    expect(r).toEqual({ outcome: { done: true }, timeoutMs: 700 });
  });
});
