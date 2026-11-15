'use strict';

const fs = require('fs');
const path = require('path');

const { workspaceDir } = require('../workspace/layout');

const DEFAULT_BACKOFF_MS = 1000;

// The status a step is recorded with, by outcome kind. A step that needs an
// agent is `skipped`, not failed.
const RECORDED_STATUS = Object.freeze({ passed: 'passed', failed: 'failed', needs_agent: 'skipped' });

// Run one step's action under its retry_policy. Fatal errors stop at once.
// A NeedsAgentError is neither retried nor a failure: it is its own kind.
// Returns { kind: 'passed' | 'failed' | 'needs_agent', attempts, error }.
async function attempt(step, ctx, perform) {
  const policy = step.retry_policy || {};
  const maxAttempts = Math.max(1, Number(policy.max_attempts) || 1);
  const backoff = policy.backoff_ms === undefined ? DEFAULT_BACKOFF_MS : Number(policy.backoff_ms);
  let lastError = null;
  for (let n = 1; n <= maxAttempts; n++) {
    try {
      await perform(step, ctx);
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

// Run a step, capture its evidence (on a checkpoint when it passed, always
// when it failed), record it in the store with what was noted on the way
// (ctx.observe, each distinct note once, as a state_context observation) and
// stamp the run trace (ok for passed and needs_agent, which is not a failure).
// A step that needs an agent (NeedsAgentError) is recorded `skipped` with
// `needs_agent: true` and takes no failure screenshot; nothing after it may
// run. `perform` is the step's action handler, resolved by the caller (the
// runner picks the action or precondition table). Returns the attempt's
// { kind, attempts, error }.
async function runStep(step, parent, perform) {
  const notes = new Set();
  const ctx = { ...parent, observe: (message) => notes.add(message) };
  const outcome = await attempt(step, ctx, perform);
  const { kind } = outcome;

  let shot = null;
  if (kind === 'passed' && step.checkpoint) shot = await screenshot(`step_${step.id}`, ctx);
  if (kind === 'failed') shot = await screenshot(`step_${step.id}_failure`, ctx);

  ctx.store.addStep({
    step_id: step.id,
    status: RECORDED_STATUS[kind],
    attempts: outcome.attempts,
    screenshot: shot,
    error_message: kind === 'passed' ? null : outcome.error.message,
    ...(kind === 'needs_agent' ? { needs_agent: true } : {}),
  });
  for (const message of notes) ctx.store.addObservation({ type: 'state_context', step_id: step.id, message });
  ctx.trace.step(kind !== 'failed');
  return outcome;
}

module.exports = { runStep, DEFAULT_BACKOFF_MS };
