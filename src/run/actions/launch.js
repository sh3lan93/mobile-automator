'use strict';

const { FatalStepError } = require('../fatal');
const { poll, timeoutFor } = require('../poll');

// launch_app: cold start by default (#255), resume when the action catalog
// maps the step's fields to `--resume` (`cold: false`). The catalog is the one
// place that decision lives, shared with `mauto launch` and the harness.
async function launchApp(step, { scenario, bridge, catalog, clock }) {
  const appId = scenario.app_package;
  const resume = catalog.stepFlagsFor('launch_app', step).includes('--resume');
  await (resume ? bridge.launchApp(appId) : bridge.restartApp(appId));

  // The drift gate. A launch that succeeded and a screen with nothing on it
  // is not "the target is missing": it is the engine's element response
  // changing shape under us, or the app failing to render. Reporting it as a
  // missing target blames the app for an engine fault, which is how #199 was
  // first misread.
  const timeoutMs = timeoutFor(step);
  const outcome = await poll(timeoutMs, async () => {
    const elements = await bridge.listElements();
    return { done: Array.isArray(elements) && elements.length > 0 };
  }, clock);
  if (!outcome.done) {
    throw new FatalStepError(
      `engine returned zero elements after a successful launch of ${appId} ` +
        `(waited ${timeoutMs}ms): the element response shape drifted or the app did not render`
    );
  }
}

module.exports = { launchApp };
