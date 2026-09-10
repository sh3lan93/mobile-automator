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
//
// A sink is a { threshold, write } pair and ALWAYS states its own threshold —
// there is no default filled in on its behalf. A test that wants the real
// thresholds wraps defaultSinks(root, env) and swaps only `write`, so it
// exercises the levels production resolves instead of a branch that exists
// only for tests.

const { makeEvent } = require('./event');
const { resolveLevels, atLeast } = require('./settings');
const stderrSink = require('./sinks/stderr');
const fileSink = require('./sinks/file');

// `logPath` is passed straight through to the file sink, which already takes it
// (sinks/file.js:44) and falls back to mauto.ndjson when it is undefined. So
// omitting it — as record() does — is exactly today's CLI behaviour, and naming
// it is how a writer with its own log file (the daemon's daemon.ndjson) gets one
// without a second copy of this list.
//
// `tracePath` adds a THIRD sink — the per-run trace — and two things about it
// are deliberate:
//
//   ADDITIONAL, not a redirect. Sending a run's events to the trace instead of
//   mauto.ndjson would punch a hole in the maintainer log across exactly the
//   invocations a bug report is about, and would let the trace's cap silently
//   drop CLI history. The cost of writing both is one extra ~300-byte
//   open/write/close per verb against a 112ms process start.
//
//   INJECTED, never resolved from `env` here. A daemon reads MAUTO_RUN_ID from
//   whichever verb spawned it and then outlives that run — its environment is
//   pinned at spawn and cannot change. Resolving the trace from `env` would
//   make boundRecorder pick it up, and the daemon would file every later run's
//   device calls under the first run's id. Only cli.js's finish() passes this.
//
// The trace's threshold is levels.file (info), the same as the main log, not
// levels.stderr (warn): a trace exists to reconstruct one run, and a threshold
// that filtered out most of a passing run's own verb.end events would defeat
// that purpose. It is deliberately not wider than `info` either — nothing in
// this slice records below `info`, so there is no debug firehose to admit by
// pinning the trace looser than the log it is bound to the same constant as.
function defaultSinks(projectRoot, env, { logPath, tracePath } = {}) {
  const levels = resolveLevels(env);
  const sinks = [
    { threshold: levels.stderr, write: (e) => stderrSink.write(e) },
    { threshold: levels.file, write: (e) => fileSink.write(e, { projectRoot, env, logPath }) },
  ];
  if (tracePath) {
    sinks.push({
      threshold: levels.file,
      // bound:'cap' — a trace must not rotate; see sinks/file.js.
      write: (e) => fileSink.write(e, { projectRoot, env, logPath: tracePath, bound: 'cap' }),
    });
  }
  return sinks;
}

function record(
  fields = {},
  { projectRoot = process.cwd(), env = process.env, sinks, tracePath } = {}
) {
  try {
    const level = fields.level || 'info';
    const list = sinks || defaultSinks(projectRoot, env, { tracePath });
    const event = makeEvent({ ...fields, level });

    for (const sink of list) {
      if (!atLeast(level, sink.threshold)) continue;
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

// The never-load-bearing guarantee, as a function instead of as a warning.
//
// record() is already total; this is for the INJECTED seams, which exist so
// that something OTHER than record() gets passed. In the daemon `call.start`
// fires before the device call, so an unguarded sink there decides whether a
// tap happens at all. Exported from here, with the seam it guards, so every
// boundary shares one implementation.
function safeObserve(observe) {
  return (fields) => {
    try {
      observe(fields);
    } catch (_) {
      /* an observability fault is never worth the work it was describing */
    }
  };
}

// record() bound to one writer, for a process that records many times.
//
// record()'s own defaults are written for a one-shot verb that records once and
// exits. Two of them are wrong for anything long-lived:
//
//   projectRoot  defaults to process.cwd(). A detached daemon inherits its cwd
//                from whichever verb spawned it and then OUTLIVES that verb —
//                the user can cd away or delete the directory. Bound once, here.
//   sinks        record() resolves levels per call. For the CLI that is once
//                per process; for a daemon it would be once per device call,
//                re-reading an environment that CANNOT change — nothing can
//                export a variable into a running detached process. So the sink
//                list is built ONCE, at construction. The consequence is worth
//                stating: MAUTO_LOG_LEVEL and MAUTO_LOG_DIR are captured at
//                construction and pinned for the caller's lifetime; for the
//                daemon, `mauto session end` is how you change them.
//
// `fields` are stamped on every event and applied AFTER the caller's, so no call
// site can forge `src`, claim another session's id or misreport its pid. That
// identity is the whole point of binding: it is what makes one process's events
// a queryable group.
//
// CONSTRUCTION is total too, and the try/catch is here rather than around each
// caller's boundRecorder() call because building sinks happens before any event
// exists, outside the returned observe's own guarantee. A failure degrades to an
// inert observe — session-log.js's frozen IGNORED handle, not a null every call
// site has to branch on.
function boundRecorder({ projectRoot, env = process.env, logPath, fields = {} } = {}) {
  let sinks;
  try {
    sinks = defaultSinks(projectRoot, env, { logPath });
  } catch (_) {
    return () => {};
  }
  return function observe(extra = {}) {
    record({ ...extra, ...fields }, { projectRoot, env, sinks });
  };
}

module.exports = { record, defaultSinks, boundRecorder, safeObserve };
