'use strict';

const { FatalStepError } = require('../fatal');

// launch_app: cold start by default (#255), resume when the action catalog
// maps the step's fields to `--resume` (`cold: false`). The catalog is the one
// place that decision lives, shared with `mauto launch` and the harness.
async function launchApp(step, { scenario, bridge, catalog, pollUntil }) {
  const appId = scenario.app_package;
  const resume = catalog.stepFlagsFor('launch_app', step).includes('--resume');
  await (resume ? bridge.launchApp(appId) : bridge.restartApp(appId));

  // The drift gate. A launch that succeeded and a screen with nothing on it
  // is not "the target is missing": it is the engine's element response
  // changing shape under us, or the app failing to render. Reporting it as a
  // missing target blames the app for an engine fault, which is how #199 was
  // first misread.
  const { outcome, timeoutMs } = await pollUntil(step, async () => {
    const elements = await bridge.listElements();
    return { done: Array.isArray(elements) && elements.length > 0 };
  });
  if (!outcome.done) {
    throw new FatalStepError(
      `engine returned zero elements after a successful launch of ${appId} ` +
        `(waited ${timeoutMs}ms): the element response shape drifted or the app did not render`
    );
  }
  await bringToFront(bridge, appId);
}

// The gate above cannot tell the app from the device home screen, which has
// elements too (#326: a launch that left the app in the background was
// recorded as passed). So ask which app is in front, and when it is another
// one, bring the scenario's app back: a plain launch, which keeps its state.
//
// Never a failure. Another app in front is also what a launch that worked
// looks like while a system permission dialog is showing, and the step that
// answers the dialog comes next. An engine that cannot report the foreground
// app (the legacy one) leaves the step as it was.
async function bringToFront(bridge, appId) {
  let inFront;
  try {
    inFront = await bridge.getForegroundApp();
  } catch {
    return;
  }
  if (inFront !== appId) await bridge.launchApp(appId);
}

module.exports = { launchApp };
