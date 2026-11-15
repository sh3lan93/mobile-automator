'use strict';

// What the evaluator reads off the device for one assertion: the element
// list, plus the screen size for only the types whose rule needs it (#276),
// so every other assertion costs no extra device call. The one place both
// `mauto assert` and `mauto run` build it; evaluator.js stays pure. A device
// error propagates — each caller decides what it means.

const { SCREEN_SIZE_TYPES } = require('./evaluator');

async function observe(bridge, type) {
  const elements = await bridge.listElements();
  const screenSize = SCREEN_SIZE_TYPES.has(type) ? await bridge.getScreenSize() : null;
  return { elements, screenSize };
}

module.exports = { observe };
