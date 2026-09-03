'use strict';

// The daemon's binding of the recorder seam.
//
// Everything here exists because the daemon is a DETACHED, LONG-LIVED process
// and record() was written for a one-shot verb that records once and exits:
//
//   projectRoot  record() defaults it to process.cwd(). The daemon inherits its
//                cwd from whichever verb happened to spawn it and then OUTLIVES
//                that verb — the user can cd away or delete the directory. So
//                it is bound once, here, from MAUTO_SESSION_PROJECT_ROOT.
//   sinks        record() resolves levels per call. For the CLI that is once
//                per process; for the daemon it would be once per device call,
//                re-reading an environment that CANNOT change — nothing can
//                export a variable into a running detached process. Resolved
//                once, at construction. Consequence: MAUTO_LOG_LEVEL and
//                MAUTO_LOG_DIR are captured at spawn and pinned for the
//                daemon's lifetime; `mauto session end` is how you change them.
//   session_id   stamped on every event so one daemon lifetime is one queryable
//                group. That is the thing run_id cannot express: a daemon that
//                dies and respawns mid-run is exactly the event worth seeing.
//
// What deliberately does NOT change: the file sink still opens, appends and
// closes per event. At the default level that is ONE append per device call,
// tens of microseconds against a device round trip of 40ms or more — and a
// buffer would be unflushed at precisely the moments this exists for (the
// uncaughtException, the SIGKILL, the call that never returned).

const { record } = require('./recorder');
const { resolveLevels } = require('./settings');
const { daemonEventLogPath } = require('./paths');
const stderrSink = require('./sinks/stderr');
const fileSink = require('./sinks/file');

function daemonSinks(projectRoot, env) {
  const levels = resolveLevels(env);
  const logPath = daemonEventLogPath(projectRoot, env);
  return [
    // The daemon's stderr IS mobile-automator/.session/daemon.log (PR #176), not
    // a terminal. That inverts cli.js finish()'s calculus: a warn line here
    // costs a human no terminal noise and lands next to the adb/simctl output
    // that explains it, which is why daemon lifecycle failures are the first
    // events in this codebase that record above `info`.
    { threshold: levels.stderr, write: (e) => stderrSink.write(e) },
    { threshold: levels.file, write: (e) => fileSink.write(e, { projectRoot, env, logPath }) },
  ];
}

// Returns observe(fields) — the single function the daemon calls. Identity
// fields are applied AFTER the caller's, so no call site can forge `src` or
// claim another session's id.
function makeDaemonRecorder({ projectRoot, sessionId, env = process.env, sinks } = {}) {
  const list = sinks || daemonSinks(projectRoot, env);
  return function observe(fields = {}) {
    record({ ...fields, src: 'daemon', session_id: sessionId }, { projectRoot, env, sinks: list });
  };
}

module.exports = { daemonSinks, makeDaemonRecorder };
