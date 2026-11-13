'use strict';

const fs = require('fs');
const path = require('path');

const { workspaceDir } = require('../workspace/layout');
const { evaluateCondition } = require('./condition');
const { substituteStep } = require('./variables');
const { handlerFor } = require('./actions');

const DEFAULT_BACKOFF_MS = 1000;

// The attempts an on_failure `retry` step gets when it names no retry_policy.
const DEFAULT_RETRY_ATTEMPTS = 2;

// The status a step is recorded with, by outcome kind. A step that needs an
// agent is `skipped`, not failed; so is one that did not apply (a false
// condition) or failed harmlessly (`optional`, `on_failure: skip`).
const RECORDED_STATUS = Object.freeze({
  passed: 'passed', failed: 'failed', skipped: 'skipped', needs_agent: 'skipped',
});

// Run one step's action under its retry policy. Fatal errors stop at once.
// A NeedsAgentError is neither retried nor a failure: it is its own kind.
// The step's `${name}` references are substituted on every attempt, so a
// reference to a variable nothing captured is a fatal error of the step.
// Returns { kind: 'passed' | 'failed' | 'needs_agent', attempts, error }.
async function attempt(step, ctx, perform) {
  const policy = step.retry_policy || {};
  const fallback = step.on_failure === 'retry' ? DEFAULT_RETRY_ATTEMPTS : 1;
  const maxAttempts = Math.max(1, Number(policy.max_attempts) || fallback);
  const backoff = policy.backoff_ms === undefined ? DEFAULT_BACKOFF_MS : Number(policy.backoff_ms);
  let lastError = null;
  for (let n = 1; n <= maxAttempts; n++) {
    try {
      await perform(substituteStep(step, ctx.variables), ctx);
      return { kind: 'passed', attempts: n, error: null };
    } catch (err) {
      lastError = err;
      if (err && err.needsAgent) return { kind: 'needs_agent', attempts: n, error: err };
      if (err && err.fatal) return { kind: 'failed', attempts: n, error: err };
      if (n < maxAttempts) await ctx.clock.sleep(backoff);
    }
  }
  return { kind: 'failed', attempts: maxAttempts, error: lastError };
}

// Capture `<workspace>/screenshots/<scenario_id>/<run_id>/<name>.png`. Returns
// the path relative to the project root (what the result file records), or
// null when the capture failed: evidence is best-effort, never a step failure,
// so a failure is only noted on the step.
async function screenshot(name, { bridge, projectRoot, scenario, runId, observe }) {
  const abs = path.join(workspaceDir(projectRoot), 'screenshots', scenario.scenario_id, runId, `${name}.png`);
  const rel = path.relative(projectRoot, abs);
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    await bridge.screenshot(abs);
    return rel;
  } catch (err) {
    observe(`screenshot ${rel} failed: ${err.message}`);
    return null;
  }
}

// What a step's condition reads, each probe asked only if the condition type
// needs it.
function conditionEnv(ctx) {
  return {
    platform: () => ctx.bridge.getPlatform(),
    orientation: () => ctx.bridge.getOrientation(),
    elements: () => ctx.bridge.listElements(),
    variables: ctx.variables,
    statuses: ctx.statuses,
    evaluator: ctx.evaluator,
  };
}

// The record kept for a step that never ran because its parent did not: skipped,
// with the same for any sub_steps of its own.
function skippedRecord(step, ctx) {
  ctx.statuses.set(step.id, 'skipped');
  const record = { step_id: step.id, status: 'skipped', screenshot: null, error_message: null };
  if (Array.isArray(step.sub_steps) && step.sub_steps.length) {
    record.sub_steps_executed = step.sub_steps.map((child) => skippedRecord(child, ctx));
  }
  return record;
}

// Execute one step without writing it: the condition, then the action under
// its retry policy, then the sub_steps. Returns { record, outcome, notes }:
// the facts to store (the shape addStep takes), the outcome kind
// ('passed' | 'failed' | 'skipped' | 'needs_agent') with its error, and the
// notes made on the way.
async function execute(step, parent, perform) {
  const notes = new Set();
  const ctx = { ...parent, observe: (message) => notes.add(message) };
  const startedAt = ctx.clock.now();

  let conditionEvaluated = null;
  let outcome = null;
  if (step.condition) {
    try {
      conditionEvaluated = await evaluateCondition(step.condition, conditionEnv(ctx));
    } catch (err) {
      conditionEvaluated = null;
      outcome = { kind: err && err.needsAgent ? 'needs_agent' : 'failed', attempts: 1, error: err };
    }
    if (conditionEvaluated === false) outcome = { kind: 'skipped', attempts: 1, error: null };
  }

  if (!outcome) {
    // The screen before the step, for a text_changed assertion that follows.
    if (ctx.wantsPrevious.has(step.id)) {
      try {
        ctx.previous.set(step.id, await ctx.bridge.listElements());
      } catch {
        // Best effort: without it the assertion says it has nothing to compare.
      }
    }
    outcome = await attempt(step, ctx, perform);
    // A failure that is only a missed chance (an optional element, a step told
    // to carry on) is skipped, not failed. A fatal error is a scenario bug and
    // stays one.
    if (outcome.kind === 'failed' && !outcome.error.fatal && (step.optional === true || step.on_failure === 'skip')) {
      notes.add(`${step.optional === true ? 'optional step' : 'step (on_failure: skip)'} failed and was skipped: ${outcome.error.message}`);
      outcome = { ...outcome, kind: 'skipped' };
    }
  }

  let shot = null;
  if (outcome.kind === 'passed' && step.checkpoint) shot = await screenshot(`step_${step.id}`, ctx);
  if (outcome.kind === 'failed') shot = await screenshot(`step_${step.id}_failure`, ctx);

  let subSteps;
  if (Array.isArray(step.sub_steps) && step.sub_steps.length) {
    if (outcome.kind === 'skipped') {
      subSteps = step.sub_steps.map((child) => skippedRecord(child, ctx));
    } else if (outcome.kind === 'passed') {
      subSteps = [];
      for (const child of step.sub_steps) {
        const done = await executeChild(child, ctx);
        subSteps.push(done.entry);
        if (done.outcome.kind === 'failed' || done.outcome.kind === 'needs_agent') {
          const message = done.outcome.error.message;
          outcome = {
            kind: done.outcome.kind,
            attempts: outcome.attempts,
            error: Object.assign(new Error(`sub-step ${child.id}: ${message}`), { needsAgent: done.outcome.kind === 'needs_agent' }),
          };
          break;
        }
      }
    }
  }

  ctx.statuses.set(step.id, RECORDED_STATUS[outcome.kind]);
  const record = {
    step_id: step.id,
    status: RECORDED_STATUS[outcome.kind],
    attempts: outcome.attempts,
    screenshot: shot,
    error_message: outcome.error ? outcome.error.message : null,
    condition_evaluated: conditionEvaluated,
    step_duration_ms: Math.max(0, Math.round(ctx.clock.now() - startedAt)),
    ...(outcome.kind === 'needs_agent' ? { needs_agent: true } : {}),
    ...(subSteps ? { sub_steps_executed: subSteps } : {}),
  };
  return { record, outcome, notes };
}

// Run a sub-step: executed like any step (condition, retries, sub_steps of its
// own), its notes and trace written at once, its assertions evaluated, and
// summarised as the entry its parent keeps.
async function executeChild(child, ctx) {
  const { record, outcome, notes } = await execute(child, ctx, handlerFor(child.action));
  for (const message of notes) ctx.store.addObservation({ type: 'state_context', step_id: child.id, message });
  ctx.trace.step(outcome.kind !== 'failed');
  await ctx.afterStep(child.id);
  const entry = {
    step_id: record.step_id,
    status: record.status,
    screenshot: record.screenshot,
    error_message: record.error_message,
    ...(record.sub_steps_executed ? { sub_steps_executed: record.sub_steps_executed } : {}),
  };
  return { entry, outcome };
}

// Run a step and record it in the store with what was noted on the way
// (ctx.observe, each distinct note once, as a state_context observation) and
// stamp the run trace (ok for everything but a failure). A step that needs an
// agent (NeedsAgentError) is recorded `skipped` with `needs_agent: true` and
// takes no failure screenshot; nothing after it may run. `perform` is the
// step's action handler, resolved by the caller (the runner picks the action
// or precondition table). Returns the outcome { kind, attempts, error } with
// kind `passed | failed | skipped | needs_agent`.
async function runStep(step, parent, perform) {
  const { record, outcome, notes } = await execute(step, parent, perform);
  parent.store.addStep(record);
  for (const message of notes) parent.store.addObservation({ type: 'state_context', step_id: step.id, message });
  parent.trace.step(outcome.kind !== 'failed');
  return outcome;
}

module.exports = { runStep, DEFAULT_BACKOFF_MS, DEFAULT_RETRY_ATTEMPTS };
