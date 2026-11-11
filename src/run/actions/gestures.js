'use strict';

const { FatalStepError } = require('../fatal');
const { resolveTarget } = require('../resolve');

// Resolve a scenario target against the current screen with the CLI's own
// matcher (ctx.evaluator), warning when the first-match rule had a choice.
async function resolveOnScreen(target, { bridge, evaluator, log }) {
  const r = resolveTarget(await bridge.listElements(), target, evaluator);
  if (r.matches.length > 1) {
    log(`  warning: target ${JSON.stringify(target)} matched ${r.matches.length} elements; using the first`);
  }
  return r;
}

async function tap(step, ctx) {
  const { center } = await resolveOnScreen(step.target, ctx);
  await ctx.bridge.tap({ x: center[0], y: center[1] });
}

async function type(step, { bridge }) {
  if (step.value === undefined || step.value === null) throw new FatalStepError('type step has no value');
  await bridge.type(String(step.value));
}

module.exports = { resolveOnScreen, tap, type };
