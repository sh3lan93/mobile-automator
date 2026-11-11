'use strict';

const { record } = require('../observe/recorder');
const { runTracePath } = require('../observe/paths');

// The run trace `mauto run` stamps: `run.start` once, before the first step,
// then one `run.step` per recorded step. Those stamps are what lets
// finalizeRun measure the run from its trace (`measurements.source: 'trace'`)
// — nothing else writes stamps during a single-process run.
//
// One method per event, each naming its event literally on the `event:` line:
// that line is what tests/lint/telemetry-vocab-drift.test.js reads as the
// producer of the name, so the vocabulary cannot drift from what is recorded.
// record() never throws, so neither does a stamp.
function makeRunTrace({ projectRoot, runId }) {
  const sinks = { projectRoot, tracePath: runTracePath(projectRoot, runId) || undefined };
  return {
    start() {
      record({ level: 'info', src: 'cli', verb: 'run', run_id: runId, event: 'run.start' }, sinks);
    },
    step(ok) {
      record({ level: 'info', src: 'cli', verb: 'run', run_id: runId, ok, event: 'run.step' }, sinks);
    },
  };
}

// What the runner stamps when no trace is injected.
const NO_TRACE = Object.freeze({ start() {}, step() {} });

module.exports = { makeRunTrace, NO_TRACE };
