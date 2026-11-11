'use strict';

// The `{ now, sleep }` `mauto run`'s polls and retry backoff read time
// through. Tests inject a fake one (tests/helpers/fake-bridge.js).
const realClock = Object.freeze({
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

module.exports = { realClock };
