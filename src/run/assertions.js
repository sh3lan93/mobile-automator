'use strict';

const { expectedOf, toEvaluatorInput } = require('../assertion/fields');
const { noJudge } = require('./judge');

// What a judge's verdict is recorded as (see src/run/judge.js for why `by` is
// `agent`).
const judgeProvenance = (judge) => ({ by: 'agent', name: judge.name, ...(judge.version && { version: judge.version }) });

// Decide one scenario assertion against the current screen and record the
// verdict with its provenance (#275):
// - a mechanical type is decided by the CLI's own evaluator (`judge.by: mauto`);
// - a Tier-2 type (`needs_agent`) is put to `judge`; a judge that cannot
//   decide leaves it pending (`judge.by: none`), which is not a failure — the
//   finalized run reads `incomplete` and an agent completes it;
// - an evaluator or judge error is a failed assertion.
// Pushes a failure line only for a decided failure.
async function runAssertion(assertion, { bridge, store, evaluator, failures, judge = noJudge }) {
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
      record.mechanical = false;
      const judged = await judge.judge(assertion, { elements });
      if (judged === null) {
        Object.assign(record, {
          pass: 'pending',
          message: `needs agent judgment (${verdict.message})`,
          judge: { by: 'none' },
        });
      } else {
        if (!judged || typeof judged.pass !== 'boolean') {
          throw new Error(`judge "${judge.name}" answered without a boolean pass`);
        }
        Object.assign(record, {
          pass: judged.pass,
          message: judged.message || 'no message',
          judge: judgeProvenance(judge),
        });
        if (judged.expected !== undefined) record.expected = judged.expected;
        if (judged.actual !== undefined) record.actual = judged.actual;
      }
    }
  } catch (err) {
    // An evaluator or judge error is a failed assertion, attributed to no one.
    Object.assign(record, { pass: false, message: `assertion errored: ${err.message}` });
    delete record.judge;
  }

  store.addAssertion(record);
  if (record.pass === false) failures.push(`assertion ${assertion.id} (${assertion.type}): ${record.message}`);
  return record.pass === true;
}

module.exports = { runAssertion };
