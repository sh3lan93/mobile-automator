'use strict';

const { settingsOf } = require('../settings');
const { resolveStep, directionOf } = require('./gestures');

// scroll_to_element: look for the target, swiping `step.value` (default up)
// between looks, up to run.scroll_max_swipes swipes. Only a miss is retried;
// a device fault propagates at once.
async function scrollToElement(step, ctx) {
  const direction = directionOf(step, 'up');
  const max = settingsOf(ctx).scrollMaxSwipes;
  for (let swipes = 0; ; swipes++) {
    try {
      return await resolveStep(step, ctx);
    } catch (err) {
      if (err.name !== 'TargetNotFoundError') throw err;
      if (swipes >= max) throw new Error(`${err.message} (after ${max} swipes ${direction})`);
    }
    await ctx.bridge.swipe({ direction });
  }
}

module.exports = { scrollToElement };
