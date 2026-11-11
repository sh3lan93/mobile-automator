'use strict';

// How long a step waits for the screen when its wait_config says nothing,
// and how often the screen is looked at meanwhile.
const DEFAULT_TIMEOUT_MS = 30000;
const POLL_MS = 1500;

function timeoutFor(step) {
  return (step.wait_config && step.wait_config.timeout_ms) || DEFAULT_TIMEOUT_MS;
}

// Poll `probe` until it returns `{ done: true, ... }` or the timeout lapses;
// returns the last outcome either way. The probe is always tried at least
// once, and once more AT the deadline, so a timeout of N ms means "the screen
// was looked at for N ms". `clock` is `{ now, sleep }`, injected so tests run
// on a fake one.
async function poll(timeoutMs, probe, { now, sleep }) {
  const start = now();
  for (;;) {
    const outcome = await probe();
    if (outcome.done) return outcome;
    if (now() - start >= timeoutMs) return outcome;
    await sleep(Math.min(POLL_MS, timeoutMs - (now() - start)));
  }
}

module.exports = { poll, timeoutFor, POLL_MS, DEFAULT_TIMEOUT_MS };
