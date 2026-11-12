'use strict';

const { expectedOf, toEvaluatorInput } = require('../assertion/fields');

// Decide one scenario assertion against the current screen and record the
// verdict with its provenance (#275):
// - a mechanical type is decided by the CLI's own evaluator (`judge.by: mauto`);
// - a Tier-2 type (`needs_agent`) is always left pending (`judge.by: none`),
//   which is not a failure — the finalized run reads `incomplete` and an
//   agent completes it. There is deliberately no judge here: any future
//   judge must not be recorded as `by: 'agent'` unless an agent actually
//   decided;
// - an evaluator error is a failed assertion.
// Pushes a failure line only for a decided failure.
async function runAssertion(assertion, { bridge, store, evaluator, failures }) {
  const record = {
    step_id: assertion.after_step,
    assertion_id: assertion.id,
    type: assertion.type,
    expected: expectedOf(assertion),
  };
  try {
    const elements = await bridge.listElements();
    const verdict = evaluator.evaluate(toEvaluatorInput(assertion), { elements });
    if (!verdict.needs_agent) {
      Object.assign(record, {
        pass: verdict.pass === true,
        message: verdict.message || 'no message',
        mechanical: true,
        judge: { by: 'mauto' },
      });
    } else {
      Object.assign(record, {
        mechanical: false,
        pass: 'pending',
        message: `needs agent judgment (${verdict.message})`,
        judge: { by: 'none' },
      });
    }
  } catch (err) {
    // An evaluator error is a failed assertion, attributed to no one.
    Object.assign(record, { pass: false, message: `assertion errored: ${err.message}` });
    delete record.judge;
  }

  store.addAssertion(record);
  if (record.pass === false) failures.push(`assertion ${assertion.id} (${assertion.type}): ${record.message}`);
  return record.pass === true;
}

module.exports = { runAssertion };
