'use strict';

const { FatalStepError } = require('../fatal');
const { resolveStep } = require('./gestures');

// capture_value: read the target's displayed text (the evaluator's own
// textOf, label fallback included) into a scenario variable, so a later
// value_matches_variable assertion can compare against it.
async function captureValue(step, ctx) {
  if (!step.capture_to) throw new FatalStepError('capture_value step has no capture_to');
  const declared = (ctx.scenario && ctx.scenario.variables) || {};
  if (!Object.prototype.hasOwnProperty.call(declared, step.capture_to)) {
    throw new FatalStepError(`capture_value step captures to undeclared variable "${step.capture_to}"`);
  }
  const { element } = await resolveStep(step, ctx);
  const value = ctx.evaluator.textOf(element);
  ctx.variables[step.capture_to] = value;
  ctx.store.captureVariable(step.capture_to, value);
}

module.exports = { captureValue };
