'use strict';

const { poll, timeoutFor } = require('../poll');
const { resolveOnScreen } = require('./gestures');

// wait_for_element: look at the screen until the target resolves or the
// step's timeout lapses. Only a miss is polled again; any other error (a
// device fault) propagates at once.
async function waitForElement(step, ctx) {
  const timeoutMs = timeoutFor(step);
  const outcome = await poll(timeoutMs, async () => {
    try {
      return { done: true, value: await resolveOnScreen(step.target, ctx) };
    } catch (err) {
      if (err.name !== 'TargetNotFoundError') throw err;
      return { done: false, error: err };
    }
  }, ctx.clock);
  if (!outcome.done) throw new Error(`timed out after ${timeoutMs}ms: ${outcome.error.message}`);
}

module.exports = { waitForElement };
