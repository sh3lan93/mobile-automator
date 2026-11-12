'use strict';

const { poll, timeoutFor } = require('../poll');
const { settingsOf } = require('../settings');
const { describeTarget } = require('../resolve');
const { resolveStep, resolveOnScreen } = require('./gestures');

// wait_for_element: look at the screen until the target resolves or the
// step's timeout lapses. Only a miss is polled again; any other error (a
// device fault) propagates at once.
async function waitForElement(step, ctx) {
  const settings = settingsOf(ctx);
  const timeoutMs = timeoutFor(step, settings);
  const outcome = await poll(timeoutMs, async () => {
    try {
      return { done: true, value: await resolveStep(step, ctx) };
    } catch (err) {
      if (err.name !== 'TargetNotFoundError') throw err;
      return { done: false, error: err };
    }
  }, ctx.clock, settings.pollMs);
  if (!outcome.done) throw new Error(`timed out after ${timeoutMs}ms: ${outcome.error.message}`);
}

// wait_for_element_gone: look until the target no longer resolves.
async function waitForElementGone(step, ctx) {
  const settings = settingsOf(ctx);
  const timeoutMs = timeoutFor(step, settings);
  const outcome = await poll(timeoutMs, async () => {
    try {
      await resolveOnScreen(step.target, { ...ctx, observe: () => {} }, step.target_pattern);
      return { done: false };
    } catch (err) {
      if (err.name !== 'TargetNotFoundError') throw err;
      return { done: true };
    }
  }, ctx.clock, settings.pollMs);
  if (!outcome.done) {
    throw new Error(`timed out after ${timeoutMs}ms: target ${describeTarget(step.target, step.target_pattern)} is still on screen`);
  }
}

// wait_for_loading_complete: done once TWO consecutive looks show no element
// matching a configured loading-indicator label (run.loading_indicator_labels,
// plus the step's wait_config.indicator word when it names one): a single
// quiet look can sit between two phases of a load. With nothing to look for,
// the step cannot know what "loading" is; it passes after the two quiet looks
// and says so on the step rather than passing silently.
async function waitForLoadingComplete(step, ctx) {
  const settings = settingsOf(ctx);
  const timeoutMs = timeoutFor(step, settings);
  const indicator = step.wait_config && step.wait_config.indicator;
  const labels = [...settings.loadingLabels];
  if (indicator && indicator !== 'any' && !labels.includes(indicator)) labels.push(indicator);
  if (labels.length === 0) {
    ctx.observe('no loading_indicator_labels configured (run.loading_indicator_labels): passed after two stable looks without checking for an indicator');
  }

  let stable = 0;
  const outcome = await poll(timeoutMs, async () => {
    const elements = await ctx.bridge.listElements();
    const list = Array.isArray(elements) ? elements : [];
    const shown = labels.filter((label) => list.some((e) => ctx.evaluator.matches(e, label)));
    if (shown.length === 0) {
      stable += 1;
      return { done: stable >= 2 };
    }
    stable = 0;
    return { done: false, shown };
  }, ctx.clock, settings.pollMs);
  if (!outcome.done) {
    const shown = (outcome.shown || []).map((l) => JSON.stringify(l)).join(', ');
    throw new Error(`timed out after ${timeoutMs}ms: a loading indicator is still on screen: ${shown}`);
  }
}

module.exports = { waitForElement, waitForElementGone, waitForLoadingComplete };
