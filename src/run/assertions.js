'use strict';

const { expectedOf, toEvaluatorInput } = require('../assertion/fields');
const { REFERENCE_SCREENSHOT_TYPES } = require('../assertion/evaluator');
const { observe } = require('../assertion/observe');
const { substituteAssertion } = require('./variables');
const { decideReferenceScreenshot } = require('./reference-assertion');
const { runArtifacts } = require('./screenshots');

// A screenshot_match (#281) is decided by comparing a stable capture against
// its reference image, not over the element list: the shared decision in
// ./reference-assertion.js, which `mauto assert` uses too, fed the same
// evaluator input (toEvaluatorInput). The actual and its diff land beside the
// run's other evidence (runArtifacts). Its verdict carries the comparison's
// paths and score; `judge.by: reference_screenshot` says the comparator
// decided it. A missing baseline is needs_agent (judge none), unless the run
// records baselines (--update-references). It records no expected value.
async function referenceVerdict(resolved, ctx) {
  const { projectRoot, scenario, runId, settings } = ctx;
  const input = toEvaluatorInput(resolved);
  const { verdict } = await decideReferenceScreenshot({
    bridge: ctx.bridge,
    clock: ctx.clock,
    settings,
    projectRoot,
    input,
    masks: resolved.masks,
    paths: runArtifacts({ projectRoot, scenarioId: scenario.scenario_id, runId, assertionId: resolved.id, input }),
    updateReferences: ctx.updateReferences === true,
    findFirst: ctx.evaluator.findFirst,
  });
  return { expected: null, ...verdict };
}

// The evaluator's answer for every other type, as the verdict to record, over
// what observe() reads off the device; a device that cannot report it errors
// the assertion (a failure, see runAssertion).
async function evaluatorVerdict(resolved, ctx, previous) {
  const { bridge, evaluator, variables = {} } = ctx;
  const { elements, screenSize } = await observe(bridge, resolved.type);
  const answer = evaluator.evaluate(toEvaluatorInput(resolved), { elements, variables, previous, screenSize });
  const expected = expectedOf(resolved);
  return answer.needs_agent
    ? {
        expected,
        status: 'needs_agent',
        message: `needs agent judgment (${answer.message})`,
        mechanical: false,
        judge: { by: 'none' },
      }
    : {
        expected,
        status: answer.pass === true ? 'passed' : 'failed',
        message: answer.message || 'no message',
        mechanical: true,
        judge: { by: 'mauto' },
      };
}

// The record body for one (substituted) assertion: `expected` plus the
// verdict and its provenance. The one place a type picks its decision.
function verdictFor(resolved, ctx, previous) {
  return REFERENCE_SCREENSHOT_TYPES.has(resolved.type)
    ? referenceVerdict(resolved, ctx)
    : evaluatorVerdict(resolved, ctx, previous);
}

// Decide one scenario assertion against the current screen and record the
// verdict with its provenance (#275):
// - a mechanical type is decided by the CLI's own evaluator (`judge.by: mauto`);
// - a Tier-2 type (`needs_agent`) is always left pending (`judge.by: none`),
//   which is not a failure — the finalized run reads `incomplete` and an
//   agent completes it. There is deliberately no judge here: any future
//   judge must not be recorded as `by: 'agent'` unless an agent actually
//   decided;
// - a screenshot_match is compared against its reference (referenceVerdict);
// - an evaluator error is a failed assertion, and so is a `${name}` that
//   names a variable nothing captured.
// `${name}` references in the assertion's string fields are replaced by the
// run's captured values first. `previous` is the screen before the step the
// assertion follows (what text_changed compares against), when one was taken.
// Pushes a failure line only for a decided failure.
async function runAssertion(assertion, ctx, previous = null) {
  const { store, failures, variables = {} } = ctx;
  let resolved = assertion;
  let body;
  try {
    resolved = substituteAssertion(assertion, variables);
    body = await verdictFor(resolved, ctx, previous);
  } catch (err) {
    // An evaluator error is a failed assertion, attributed to no one. (A
    // screenshot_match has no expected field, so expectedOf is null for it.)
    body = { expected: expectedOf(resolved), status: 'failed', message: `assertion errored: ${err.message}` };
  }

  const record = { step_id: assertion.after_step, assertion_id: assertion.id, type: assertion.type, ...body };
  store.addAssertion(record);
  if (record.status === 'failed') failures.push(`assertion ${assertion.id} (${assertion.type}): ${record.message}`);
  return record.status === 'passed';
}

module.exports = { runAssertion, REFERENCE_SCREENSHOT_TYPES };
