'use strict';

const { runSettings, settingsOf, DEFAULTS } = require('../../../src/run/settings');
const { timeoutFor, poll } = require('../../../src/run/poll');

describe('runSettings', () => {
  test.each([null, undefined, {}, { run: null }, { run: 'x' }])('defaults when config is %j', (config) => {
    expect(runSettings(config)).toEqual({
      pollMs: DEFAULTS.pollMs,
      defaultTimeoutMs: DEFAULTS.defaultTimeoutMs,
      scrollMaxSwipes: DEFAULTS.scrollMaxSwipes,
      loadingLabels: [],
      timeoutCapMs: null,
    });
  });

  test('reads the run block', () => {
    const s = runSettings({ run: { poll_ms: 500, default_timeout_ms: 9000, scroll_max_swipes: 4, loading_indicator_labels: ['Loading', ' ', 7] } });
    expect(s).toMatchObject({ pollMs: 500, defaultTimeoutMs: 9000, scrollMaxSwipes: 4, loadingLabels: ['Loading'] });
  });

  test('a value the schema would refuse falls back to its default', () => {
    const s = runSettings({ run: { poll_ms: 0, default_timeout_ms: 'fast', scroll_max_swipes: -1 } });
    expect(s).toMatchObject({ pollMs: 1500, defaultTimeoutMs: 30000, scrollMaxSwipes: 10 });
  });

  test('scroll_max_swipes may be 0 (look once, never swipe)', () => {
    expect(runSettings({ run: { scroll_max_swipes: 0 } }).scrollMaxSwipes).toBe(0);
  });

  test('timeoutMs becomes the cap', () => {
    expect(runSettings(null, { timeoutMs: 2000 }).timeoutCapMs).toBe(2000);
  });

  test('settingsOf falls back to the defaults for a ctx without settings', () => {
    expect(settingsOf({}).pollMs).toBe(1500);
    expect(settingsOf({ settings: { pollMs: 5 } }).pollMs).toBe(5);
  });
});

describe('timeoutFor with settings', () => {
  test('the configured default replaces the built-in one', () => {
    expect(timeoutFor({}, runSettings({ run: { default_timeout_ms: 8000 } }))).toBe(8000);
  });

  test("a step's own timeout still wins over the configured default", () => {
    expect(timeoutFor({ wait_config: { timeout_ms: 5000 } }, runSettings({ run: { default_timeout_ms: 8000 } }))).toBe(5000);
  });

  test('the cap shortens a longer wait and never lengthens a shorter one', () => {
    const s = runSettings(null, { timeoutMs: 4000 });
    expect(timeoutFor({ wait_config: { timeout_ms: 20000 } }, s)).toBe(4000);
    expect(timeoutFor({}, s)).toBe(4000);
    expect(timeoutFor({ wait_config: { timeout_ms: 2000 } }, s)).toBe(2000);
  });
});

describe('poll with a configured gap', () => {
  test('sleeps the configured pollMs between looks', async () => {
    let t = 0;
    const sleeps = [];
    const clock = { now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; } };
    await poll(1000, async () => ({ done: false }), clock, 400);
    expect(sleeps).toEqual([400, 400, 200]);
  });
});
