'use strict';

const fs = require('fs');
const path = require('path');

const { workspaceDir } = require('../workspace/layout');
const { handlerFor } = require('./actions');

const DEFAULT_BACKOFF_MS = 1000;

// Run one step's action under its retry_policy. Fatal errors stop at once.
// Returns { ok, attempts, error }.
async function attempt(step, ctx) {
  const perform = handlerFor(step.action);
  const policy = step.retry_policy || {};
  const maxAttempts = Math.max(1, Number(policy.max_attempts) || 1);
  const backoff = policy.backoff_ms === undefined ? DEFAULT_BACKOFF_MS : Number(policy.backoff_ms);
  let lastError = null;
  for (let n = 1; n <= maxAttempts; n++) {
    try {
      await perform(step, ctx);
      return { ok: true, attempts: n, error: null };
    } catch (err) {
      lastError = err;
      if (err && err.fatal) return { ok: false, attempts: n, error: err };
      if (n < maxAttempts) await ctx.clock.sleep(backoff);
    }
  }
  return { ok: false, attempts: maxAttempts, error: lastError };
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
// stamp the run trace. Returns { ok, attempts, error }.
async function runStep(step, parent) {
  const notes = new Set();
  const ctx = { ...parent, observe: (message) => notes.add(message) };
  const outcome = await attempt(step, ctx);

  let shot = null;
  if (outcome.ok && step.checkpoint) shot = await screenshot(`step_${step.id}`, ctx);
  if (!outcome.ok) shot = await screenshot(`step_${step.id}_failure`, ctx);

  ctx.store.addStep({
    step_id: step.id,
    status: outcome.ok ? 'passed' : 'failed',
    attempts: outcome.attempts,
    screenshot: shot,
    error_message: outcome.ok ? null : outcome.error.message,
  });
  for (const message of notes) ctx.store.addObservation({ type: 'state_context', step_id: step.id, message });
  ctx.trace.step(outcome.ok);
  return outcome;
}

module.exports = { runStep, DEFAULT_BACKOFF_MS };
