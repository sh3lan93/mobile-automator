'use strict';

// The single seam. Everything that wants to be observable calls record().
//
// Two properties are load-bearing and both are tested:
//
//   1. It never throws and never propagates. Observability is not allowed to
//      be the reason a verb fails, so each sink is individually guarded and
//      the whole body is wrapped again. A throwing sink must not deprive its
//      neighbours of the event.
//   2. It writes nothing to stdout. That is a property of the sinks, but the
//      recorder is where the sink list is chosen, so it is the enforcement
//      point for which sinks exist at all.
//
// Level filtering happens here rather than in the sinks because the two sinks
// have DIFFERENT thresholds (stderr warn, file info) and only the recorder
// knows which sink it is currently feeding.

const { makeEvent } = require('./event');
const { resolveLevels, atLeast } = require('./settings');
const stderrSink = require('./sinks/stderr');
const fileSink = require('./sinks/file');

function defaultSinks(projectRoot, env) {
  const levels = resolveLevels(env);
  return [
    { threshold: levels.stderr, write: (e) => stderrSink.write(e) },
    { threshold: levels.file, write: (e) => fileSink.write(e, { projectRoot, env }) },
  ];
}

function record(fields = {}, { projectRoot = process.cwd(), env = process.env, sinks } = {}) {
  try {
    const level = fields.level || 'info';
    const list = sinks || defaultSinks(projectRoot, env);
    // An injected sink with no threshold of its own is filtered against the
    // resolved stderr threshold, so tests exercise the real gate rather than
    // an unfiltered bypass.
    const fallback = resolveLevels(env).stderr;
    const event = makeEvent({ ...fields, level });

    for (const sink of list) {
      const threshold = sink.threshold === undefined ? fallback : sink.threshold;
      if (!atLeast(level, threshold)) continue;
      try {
        sink.write(event);
      } catch (_) {
        // One bad sink must not deprive the others.
      }
    }
  } catch (_) {
    // Belt and suspenders: a hostile event (cyclic, exotic getters) must not
    // escape as an exception into the verb's own control flow.
  }
}

module.exports = { record, defaultSinks };
