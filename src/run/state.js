'use strict';

// What a run remembers about the steps it has already done, for the things
// that read the past: a `previous_step_skipped` condition (each step's
// recorded status) and a `text_changed` assertion (the screen before the step
// it follows). Built once per run from the scenario's assertions, so a
// snapshot is taken only for the steps some text_changed assertion follows and
// every other scenario pays no extra device call.
function createRunState(assertions) {
  const statuses = new Map();
  const snapshots = new Map();
  const wanted = new Set(assertions.filter((a) => a.type === 'text_changed').map((a) => a.after_step));
  return {
    statusOf: (stepId) => statuses.get(stepId),
    setStatus: (stepId, status) => statuses.set(stepId, status),
    wantsSnapshot: (stepId) => wanted.has(stepId),
    remember: (stepId, elements) => snapshots.set(stepId, elements),
    snapshotOf: (stepId) => snapshots.get(stepId) || null,
  };
}

module.exports = { createRunState };
