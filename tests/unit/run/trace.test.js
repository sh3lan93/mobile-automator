'use strict';

// makeRunTrace: the run trace `mauto run` stamps, read back through the same
// readTrace finalizeRun measures from.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { makeRunTrace, NO_TRACE } = require('../../../src/run/trace');
const { runTracePath } = require('../../../src/observe/paths');
const { readTrace } = require('../../../src/observe/trace');

const RUN_ID = 'run_20261111_100000';
const ENV_KEYS = ['MAUTO_LOG_DIR', 'MAUTO_LOG_LEVEL'];

let root;
let saved;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-run-trace-'));
  fs.mkdirSync(path.join(root, '.mobile-automator'));
  fs.writeFileSync(path.join(root, '.mobile-automator', 'config.json'), '{}');
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('start() then step(ok) stamp run.start and run.step into the run trace, tagged with the verb and run id', () => {
  const trace = makeRunTrace({ projectRoot: root, runId: RUN_ID });
  trace.start();
  trace.step(true);
  trace.step(false);
  const events = readTrace(runTracePath(root, RUN_ID)).events;
  expect(events.map((e) => e.event)).toEqual(['run.start', 'run.step', 'run.step']);
  expect(events.every((e) => e.verb === 'run' && e.run_id === RUN_ID)).toBe(true);
  expect(events.slice(1).map((e) => e.ok)).toEqual([true, false]);
});

test('NO_TRACE stamps nothing and never throws', () => {
  expect(() => {
    NO_TRACE.start();
    NO_TRACE.step(true);
  }).not.toThrow();
});
