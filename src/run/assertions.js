'use strict';

const { expectedOf, toEvaluatorInput } = require('../assertion/fields');

// Decide one scenario assertion against the current screen with the CLI's
// own evaluator, record the verdict, and push a failure line when it did not
// pass. Returns whether it passed.
async function runAssertion(assertion, { bridge, store, evaluator, failures }) {
  let pass = false;
  let message;
  try {
    const verdict = evaluator.evaluate(toEvaluatorInput(assertion), { elements: await bridge.listElements() });
    if (verdict.needs_agent) {
      // This release decides only mechanical assertions; a Tier-2 one is a
      // failure, never a silent pass. (Replay R2 records it as needs_agent.)
      message = `needs agent judgment; mauto run decides only mechanical assertions in this release (${verdict.message})`;
    } else {
      pass = verdict.pass === true;
      message = verdict.message || 'no message';
    }
  } catch (err) {
    message = `assertion errored: ${err.message}`;
  }

  store.addAssertion({
    step_id: assertion.after_step,
    assertion_id: assertion.id,
    type: assertion.type,
    pass,
    message,
    expected: expectedOf(assertion),
  });
  if (!pass) failures.push(`assertion ${assertion.id} (${assertion.type}): ${message}`);
  return pass;
}

module.exports = { runAssertion };
