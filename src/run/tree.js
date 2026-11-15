'use strict';

// Walking a step and its sub_steps. step.js runs ONE step's own work; this is
// where a step with `sub_steps` becomes a tree: children run after a parent
// that passed, are skipped (assertions and all) under a parent that was, and
// are summarised on the parent's record as `sub_steps_executed`. The runner
// resolves the top-level handler; a sub-step's is resolved here, from the same
// action table.
//
// `afterStep(stepId)` evaluates the assertions that follow a step. It is
// passed down rather than kept on ctx, because only the runner knows the
// scenario's assertions.

const { runOne, RECORDED_STATUS } = require('./step');
const { handlerFor } = require('./actions');

const hasSubSteps = (step) => Array.isArray(step.sub_steps) && step.sub_steps.length > 0;

// What a parent keeps of a sub-step it ran.
function entryOf(record) {
  return {
    step_id: record.step_id,
    status: record.status,
    screenshot: record.screenshot,
    error_message: record.error_message,
    ...(record.sub_steps_executed ? { sub_steps_executed: record.sub_steps_executed } : {}),
  };
}

// A step that never ran because its parent did not: recorded skipped, like
// everything under it, and its assertions still evaluated (they describe the
// screen the scenario expects either way).
async function skipNode(step, ctx, afterStep) {
  ctx.state.setStatus(step.id, 'skipped');
  const entry = { step_id: step.id, status: 'skipped', screenshot: null, error_message: null };
  if (hasSubSteps(step)) entry.sub_steps_executed = await skipAll(step.sub_steps, ctx, afterStep);
  await afterStep(step.id);
  return entry;
}

async function skipAll(steps, ctx, afterStep) {
  const entries = [];
  for (const step of steps) entries.push(await skipNode(step, ctx, afterStep));
  return entries;
}

// Write what a step noted on the way (each as a state_context observation)
// and stamp the run trace: ok for everything but a failure.
function settle(step, { outcome, notes }, ctx) {
  for (const message of notes) ctx.store.addObservation({ type: 'state_context', step_id: step.id, message });
  ctx.trace.step(outcome.kind !== 'failed');
}

// Run a step and, when it passed, its sub_steps in order, stopping at the
// first one that failed or needs an agent: the parent then takes that
// sub-step's kind and error (so `fatal` and `needsAgent` stay on the one real
// error), and its message says which sub-step. Writes nothing for `step`
// itself; returns { record, outcome, notes } for the caller to commit.
async function runNode(step, perform, ctx, afterStep) {
  const node = await runOne(step, ctx, perform);
  const { record } = node;
  ctx.state.setStatus(step.id, record.status);
  if (!hasSubSteps(step)) return node;

  if (node.outcome.kind === 'skipped') {
    record.sub_steps_executed = await skipAll(step.sub_steps, ctx, afterStep);
  } else if (node.outcome.kind === 'passed') {
    record.sub_steps_executed = [];
    for (const child of step.sub_steps) {
      const done = await runNode(child, handlerFor(child.action), ctx, afterStep);
      settle(child, done, ctx);
      await afterStep(child.id);
      record.sub_steps_executed.push(entryOf(done.record));
      const { kind } = done.outcome;
      if (kind === 'failed' || kind === 'needs_agent') {
        node.outcome = done.outcome;
        record.status = RECORDED_STATUS[kind];
        record.error_message = `sub-step ${child.id}: ${done.record.error_message}`;
        if (kind === 'needs_agent') record.needs_agent = true;
        ctx.state.setStatus(step.id, record.status);
        break;
      }
    }
  }
  return node;
}

// Run a top-level step (or precondition) and its sub_steps, and record it.
async function runStep(step, perform, ctx, afterStep) {
  const node = await runNode(step, perform, ctx, afterStep);
  ctx.store.addStep(node.record);
  settle(step, node, ctx);
  return node;
}

module.exports = { runStep };
