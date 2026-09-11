'use strict';

// Photograph a device failure while the bridge is still live.
//
// The value is in what it replaces: today a failed run's result file carries
// the agent's NARRATIVE of what the screen looked like. This makes it carry the
// screen.
//
// It is a module rather than four lines inside connectBridge because every one
// of its rules is a rule about failure handling, and they are easier to state —
// and to test — where they are not interleaved with commander:
//
//   1. It never throws. A capture is a daemon round-trip and can fail for
//      exactly the reasons the original call failed.
//   2. It never touches the caller's result. The original error is what the
//      agent needs; the screenshot is a footnote. The return value is
//      deliberately ignored at the call site, and the envelope reaches emit()
//      byte-identical whether this succeeded, failed, or never ran.
//   3. It captures only what it can correlate. With no run id there is no trace
//      to reference the file from and no finalize to collect it, so the PNG
//      would be litter in a directory the user did not ask us to fill — the
//      same argument the file sink already makes about creating
//      mobile-automator/. It also makes the run id the single switch for this
//      whole slice: export it and you get traces, measured durations and
//      failure evidence; leave it unset and 0.24.0's behaviour is unchanged.

const realFs = require('fs');
const path = require('path');

const { record } = require('./recorder');
const { runTracePath } = require('./paths');

// The failure kinds worth a picture.
//
// `device` is the ordinary "the device said no". `timeout` is included
// deliberately and is arguably the more valuable of the two: a timed-out call
// may have PARTIALLY executed — session-client's own hint says so — and the
// screen is the only way to find out what actually happened.
//
// `invalid_input` is excluded: nothing reached the device, so the picture would
// show the state BEFORE the verb and be evidence of nothing. `internal` is
// excluded for the same reason, and because a crashed CLI has a stack trace,
// which is the artifact that actually helps.
const CAPTURED_KINDS = new Set(['device', 'timeout']);

function isCapturable(result) {
  return Boolean(
    result && result.envelope && result.envelope.ok === false && CAPTURED_KINDS.has(result.exitKind)
  );
}

// mobile-automator/screenshots/<runId>/<verb>-<ts>.png.
//
// Under screenshots/, NOT results/<run_id>/screenshots/ which the execute guide
// uses for agent-directed captures, because `mauto setup` writes
// mobile-automator/.gitignore covering `screenshots/` and not the results tree.
// A photograph of a failing app is precisely the artifact that must not ride
// into a user's commit on a `git add -A`.
function failureShotPath(projectRoot, runId, verb) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(
    projectRoot,
    'mobile-automator',
    'screenshots',
    runId,
    `${verb || 'device'}-${stamp}.png`
  );
}

async function captureOnFailure({
  bridge,
  result,
  projectRoot,
  runId,
  verb,
  env = process.env,
  fs = realFs,
} = {}) {
  // Resolved once and reused as BOTH the trace target and the is-this-id-safe
  // predicate — one gate rather than a second check that can disagree with it.
  // Declared here and assigned inside the try so a non-string projectRoot
  // (path.join throws via logsDir for a VALID run id) is caught by this
  // function's own catch instead of escaping to a caller that has none.
  let tracePath = null;
  try {
    tracePath = runTracePath(projectRoot, runId, env);
    if (!isCapturable(result)) return null;
    if (!tracePath) return null;
    if (!bridge || typeof bridge.screenshot !== 'function') return null;

    const dest = failureShotPath(projectRoot, runId, verb);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // Bounded by the layers below, not here: the daemon fails a call at
    // DAEMON_CALL_TIMEOUT_MS and the client gives up on a reply at its own
    // timeout, so this cannot wait forever. A third bound would be a third
    // policy to keep in step with the other two.
    const saved = (await bridge.screenshot(dest)) || dest;

    record(
      {
        // info, not warn — the inverse of slice 2's daemon choice, for slice
        // 2's own reason. The daemon's stderr is a log file; the CLI's is a
        // human's terminal, and the envelope has already told them the verb
        // failed. A second line about the screenshot is noise on top of noise.
        level: 'info',
        src: 'cli',
        event: 'screenshot.on_failure',
        verb,
        run_id: runId,
        error_kind: result.envelope.error && result.envelope.error.kind,
        // sends:false in the event catalog — a path leaks usernames and project
        // layout, so it stays local. `result finalize` reads it back from here.
        path: saved,
      },
      { projectRoot, env, tracePath }
    );
    return saved;
  } catch (err) {
    // Recorded and discarded. Replacing the original error with "could not take
    // a screenshot" would answer a question nobody asked and lose the answer to
    // the one they did.
    try {
      record(
        {
          level: 'info',
          src: 'cli',
          event: 'screenshot.capture_failed',
          verb,
          run_id: runId,
          message: (err && (err.message || String(err))) || 'unknown capture failure',
        },
        { projectRoot, env, tracePath }
      );
    } catch (_) {
      // record() is already total; this exists so the outer catch cannot itself
      // be the thing that throws.
    }
    return null;
  }
}

module.exports = { captureOnFailure, isCapturable, CAPTURED_KINDS };
