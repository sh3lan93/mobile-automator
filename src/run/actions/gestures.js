'use strict';

const { FatalStepError } = require('../fatal');
const { resolveTarget } = require('../resolve');

const DIRECTIONS = ['up', 'down', 'left', 'right'];

// Resolve a scenario target (or target_pattern) against the current screen
// with the CLI's own matcher (ctx.evaluator). When the first-match rule had a
// choice to make, it says so through ctx.observe, which runStep records on
// the step.
async function resolveOnScreen(target, { bridge, evaluator, observe }, pattern) {
  // An invalid target_pattern cannot be fixed by retrying.
  if (typeof pattern === 'string' && pattern !== '') {
    try {
      new RegExp(pattern);
    } catch (err) {
      throw new FatalStepError(`invalid target_pattern ${JSON.stringify(pattern)}: ${err.message}`);
    }
  }
  const r = resolveTarget(await bridge.listElements(), target, evaluator, { pattern });
  if (r.matches.length > 1) {
    const what = typeof target === 'string' && target.trim() !== '' ? JSON.stringify(target) : `pattern /${pattern}/`;
    observe(`target ${what} matched ${r.matches.length} elements; used the first`);
  }
  return r;
}

const resolveStep = (step, ctx) => resolveOnScreen(step.target, ctx, step.target_pattern);

function requireValue(step) {
  if (step.value === undefined || step.value === null || String(step.value).trim() === '') {
    throw new FatalStepError(`${step.action} step has no value`);
  }
  return String(step.value);
}

function directionOf(step, fallback) {
  const raw = step.value === undefined || step.value === null ? fallback : step.value;
  const direction = typeof raw === 'string' ? raw.toLowerCase() : raw;
  if (!DIRECTIONS.includes(direction)) {
    throw new FatalStepError(`${step.action} step needs a direction (${DIRECTIONS.join(' | ')}), got ${JSON.stringify(step.value)}`);
  }
  return direction;
}

async function tap(step, ctx) {
  const { center } = await resolveStep(step, ctx);
  await ctx.bridge.tap({ x: center[0], y: center[1] });
}

async function type(step, { bridge }) {
  if (step.value === undefined || step.value === null) throw new FatalStepError('type step has no value');
  await bridge.type(String(step.value));
}

// A numeric `value` is the press duration in ms; anything else leaves the
// engine's default.
async function longPress(step, ctx) {
  const { center } = await resolveStep(step, ctx);
  const args = { x: center[0], y: center[1] };
  const ms = Number(step.value);
  if (step.value !== undefined && step.value !== null && step.value !== '' && Number.isFinite(ms) && ms > 0) {
    args.duration = ms;
  }
  await ctx.bridge.longPress(args);
}

async function doubleTap(step, ctx) {
  const { center } = await resolveStep(step, ctx);
  await ctx.bridge.doubleTap({ x: center[0], y: center[1] });
}

async function swipe(step, { bridge }) {
  await bridge.swipe({ direction: directionOf(step) });
}

async function pressButton(step, { bridge }) {
  await bridge.pressButton(requireValue(step).toUpperCase());
}

async function openUrl(step, { bridge }) {
  await bridge.openUrl(requireValue(step));
}

module.exports = {
  resolveOnScreen, resolveStep, directionOf, DIRECTIONS,
  tap, type, longPress, doubleTap, swipe, pressButton, openUrl,
};
