'use strict';

const { runSettings } = require('./settings');

// The defaults a run uses when neither the workspace config's `run` block nor
// a step says otherwise: how long a step waits for the screen, and how often
// the screen is looked at meanwhile. Kept as exports for callers and tests;
// the live values come from the run's settings (src/run/settings.js).
const DEFAULT_SETTINGS = runSettings(null);
const DEFAULT_TIMEOUT_MS = DEFAULT_SETTINGS.defaultTimeoutMs;
const POLL_MS = DEFAULT_SETTINGS.pollMs;

// A step's wait budget: its own wait_config.timeout_ms, else the configured
// default, and never more than the --timeout-ms cap when one was given.
function timeoutFor(step, settings = DEFAULT_SETTINGS) {
  const own = (step.wait_config && step.wait_config.timeout_ms) || settings.defaultTimeoutMs;
  return settings.timeoutCapMs ? Math.min(own, settings.timeoutCapMs) : own;
}

// Poll `probe` until it returns `{ done: true, ... }` or the timeout lapses;
// returns the last outcome either way. The probe is always tried at least
// once, and once more AT the deadline, so a timeout of N ms means "the screen
// was looked at for N ms". `clock` is `{ now, sleep }`, injected so tests run
// on a fake one; `pollMs` is the gap between looks.
async function poll(timeoutMs, probe, { now, sleep }, pollMs = POLL_MS) {
  const start = now();
  for (;;) {
    const outcome = await probe();
    if (outcome.done) return outcome;
    if (now() - start >= timeoutMs) return outcome;
    await sleep(Math.min(pollMs, timeoutMs - (now() - start)));
  }
}

module.exports = { poll, timeoutFor, POLL_MS, DEFAULT_TIMEOUT_MS };
