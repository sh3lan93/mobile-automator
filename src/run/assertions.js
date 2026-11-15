'use strict';

const path = require('path');

const { expectedOf, toEvaluatorInput } = require('../assertion/fields');
const { REFERENCE_SCREENSHOT_TYPES, findFirst } = require('../assertion/evaluator');
const { workspaceDir } = require('../workspace/layout');
const { substituteAssertion } = require('./variables');
const { decideReferenceScreenshot } = require('./reference-assertion');
const { resolveReference } = require('./screenshots');
const { timeoutFor } = require('./poll');

// A screenshot_match (#281) is decided by comparing a stable capture against
// its reference image, not over the element list: the shared decision in
// ./reference-assertion.js, which `mauto assert` uses too. The actual and its
// diff land beside the run's other evidence. Its verdict carries the
// comparison's paths and score; `judge.by: reference_screenshot` says the
// comparator decided it. A missing baseline is needs_agent (judge none),
// unless the run records baselines (--update-references).
async function referenceVerdict(assertion, ctx) {
  const { projectRoot, scenario, runId, settings } = ctx;
  const dir = path.join(workspaceDir(projectRoot), 'screenshots', scenario.scenario_id, runId);
  const v = await decideReferenceScreenshot({
    bridge: ctx.bridge,
    clock: ctx.clock,
    projectRoot,
    referencePath: resolveReference(projectRoot, assertion, scenario.scenario_id),
    actualPath: path.join(dir, `assert_${assertion.id}.png`),
    diffPath: path.join(dir, `assert_${assertion.id}.diff.png`),
    tolerance: assertion.tolerance,
    masks: assertion.masks,
    updateReferences: ctx.updateReferences === true,
    timeoutMs: timeoutFor({}, settings),
    pollMs: settings.pollMs,
    findFirst: (ctx.evaluator && ctx.evaluator.findFirst) || findFirst,
  });
  return {
    status: v.status,
    message: v.message,
    mechanical: v.mechanical,
    judge: v.judge,
    reference_screenshot: v.reference_screenshot,
    actual_screenshot: v.actual_screenshot,
    similarity_score: v.similarity_score,
  };
}

// The evaluator's answer for every other type, as the verdict to record.
function evaluatorVerdict(evaluator, resolved, elements, variables, previous) {
  const answer = evaluator.evaluate(toEvaluatorInput(resolved), { elements, variables, previous });
  return answer.needs_agent
    ? {
        status: 'needs_agent',
        message: `needs agent judgment (${answer.message})`,
        mechanical: false,
        judge: { by: 'none' },
      }
    : {
        status: answer.pass === true ? 'passed' : 'failed',
        message: answer.message || 'no message',
        mechanical: true,
        judge: { by: 'mauto' },
      };
}

// Decide one scenario assertion against the current screen and record the
// verdict with its provenance (#275):
// - a mechanical type is decided by the CLI's own evaluator (`judge.by: mauto`);
// - a Tier-2 type (`needs_agent`) is always left pending (`judge.by: none`),
//   which is not a failure — the finalized run reads `incomplete` and an
//   agent completes it. There is deliberately no judge here: any future
//   judge must not be recorded as `by: 'agent'` unless an agent actually
//   decided;
// - an evaluator error is a failed assertion, and so is a `${name}` that
//   names a variable nothing captured.
// `${name}` references in the assertion's string fields are replaced by the
// run's captured values first. `previous` is the screen before the step the
// assertion follows (what text_changed compares against), when one was taken.
// A screenshot_match branches before the evaluator (see referenceVerdict).
// Pushes a failure line only for a decided failure.
async function runAssertion(assertion, ctx, previous = null) {
  const { bridge, store, evaluator, failures, variables = {} } = ctx;
  let resolved = assertion;
  let verdict;
  try {
    resolved = substituteAssertion(assertion, variables);
    verdict = REFERENCE_SCREENSHOT_TYPES.has(resolved.type)
      ? await referenceVerdict(resolved, ctx)
      : evaluatorVerdict(evaluator, resolved, await bridge.listElements(), variables, previous);
  } catch (err) {
    // An evaluator error is a failed assertion, attributed to no one.
    verdict = { status: 'failed', message: `assertion errored: ${err.message}` };
  }

  const record = {
    step_id: assertion.after_step,
    assertion_id: assertion.id,
    type: assertion.type,
    expected: REFERENCE_SCREENSHOT_TYPES.has(assertion.type) ? null : expectedOf(resolved),
    ...verdict,
  };
  store.addAssertion(record);
  if (record.status === 'failed') failures.push(`assertion ${assertion.id} (${assertion.type}): ${record.message}`);
  return record.status === 'passed';
}

module.exports = { runAssertion, REFERENCE_SCREENSHOT_TYPES };
