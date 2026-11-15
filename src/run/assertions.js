'use strict';

const { expectedOf, toEvaluatorInput } = require('../assertion/fields');
const { substituteAssertion } = require('./variables');

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
// Pushes a failure line only for a decided failure.
async function runAssertion(assertion, { bridge, store, evaluator, failures, variables = {} }, previous = null) {
  let resolved = assertion;
  let verdict;
  try {
    resolved = substituteAssertion(assertion, variables);
    const elements = await bridge.listElements();
    const answer = evaluator.evaluate(toEvaluatorInput(resolved), { elements, variables, previous });
    verdict = answer.needs_agent
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
  } catch (err) {
    // An evaluator error is a failed assertion, attributed to no one.
    verdict = { status: 'failed', message: `assertion errored: ${err.message}` };
  }

  const record = {
    step_id: assertion.after_step,
    assertion_id: assertion.id,
    type: assertion.type,
    expected: expectedOf(resolved),
    ...verdict,
  };
  store.addAssertion(record);
  if (record.status === 'failed') failures.push(`assertion ${assertion.id} (${assertion.type}): ${record.message}`);
  return record.status === 'passed';
}

module.exports = { runAssertion };
