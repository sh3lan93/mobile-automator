'use strict';

// A step's wait budget: its own wait_config.timeout_ms, else the configured
// default, and never more than the --timeout-ms cap when one was given.
// `settings` is the run's (src/run/settings.js).
function timeoutFor(step, settings) {
  const own = (step.wait_config && step.wait_config.timeout_ms) || settings.defaultTimeoutMs;
  return settings.timeoutCapMs ? Math.min(own, settings.timeoutCapMs) : own;
}

// Poll `probe` until it returns `{ done: true, ... }` or the timeout lapses;
// returns the last outcome either way. The probe is always tried at least
// once, and once more AT the deadline, so a timeout of N ms means "the screen
// was looked at for N ms". `clock` is `{ now, sleep }`, injected so tests run
// on a fake one; `pollMs` is the gap between looks.
async function poll(timeoutMs, probe, { now, sleep }, pollMs) {
  const start = now();
  for (;;) {
    const outcome = await probe();
    if (outcome.done) return outcome;
    if (now() - start >= timeoutMs) return outcome;
    await sleep(Math.min(pollMs, timeoutMs - (now() - start)));
  }
}

// The one way a handler waits: `ctx.pollUntil(step, probe)` looks until the
// probe is done or the step's budget lapses, and returns the last outcome
// with the budget it used (for the timeout message). Built once per run from
// its settings and clock.
function makePollUntil(settings, clock) {
  return async (step, probe) => {
    const timeoutMs = timeoutFor(step, settings);
    const outcome = await poll(timeoutMs, probe, clock, settings.pollMs);
    return { outcome, timeoutMs };
  };
}

module.exports = { poll, timeoutFor, makePollUntil };
