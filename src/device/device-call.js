'use strict';

// One bounded, measured device call.
//
// Wraps the daemon's single injected `call` so that invoking a mobile-mcp
// primitive is one thing with one contract — "it answers within timeoutMs, and
// it leaves a trace either way" — instead of ninety lines inlined into a socket
// data handler, where the device logic and the telemetry were interleaved at
// nesting depth 6 and neither could be read on its own.
//
// Why this is ONE concept and not two. The obvious split (a timeout wrapper,
// then an instrumentation wrapper around it) does not survive contact with the
// events: `call.end` reports error_kind, and the only way to know a failure was
// a timeout rather than a device error is `err.kind === 'timeout'` — a marker
// this module itself invents on the timeout path. Split them and the outer
// layer has to re-derive the inner layer's classification by sniffing an error
// property, which is the same coupling with an extra seam in front of it. The
// bound and the measurement are the same fact about a call.
//
// Built ONCE per daemon, right after createCall resolves, and then shared by
// every connection. That is deliberate: the timeout, the sink and the
// connection are all per-daemon, so nothing here needs a per-connection
// identity. WARNING for anyone extending it: this means a `let` at factory
// scope would be cross-connection shared state, mutated by concurrent calls
// from unrelated sockets (the daemon multiplexes, and frames from two sockets
// interleave freely). Everything mutable must stay inside `invoke`.
//
// Everything it needs is injected — no defaults — because every one of these
// has a failure mode that is silent if it is wrong. See the construction-time
// validation below.

const { isKnownTool } = require('./mobile-mcp-tools');

function makeDeviceCall(call, { scheduleTimeout, observe, timeoutMs } = {}) {
  // Validate at CONSTRUCTION, loudly, rather than defaulting. A default here
  // would be worse than a crash: with `timeoutMs` undefined,
  // scheduleTimeout(undefined) is setTimeout(fn, undefined) is setTimeout(fn, 0),
  // so EVERY device call would lose its race and fail with "... did not respond
  // within undefinedms" — an entire session broken, in a way no test asserts
  // against because every test injects its own scheduleTimeout. Failing at
  // build time means the daemon never starts instead of starting useless.
  if (typeof call !== 'function') throw new TypeError('makeDeviceCall requires a call function');
  if (typeof observe !== 'function') throw new TypeError('makeDeviceCall requires an observe function');
  if (typeof scheduleTimeout !== 'function') {
    throw new TypeError('makeDeviceCall requires a scheduleTimeout function');
  }
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('makeDeviceCall requires a finite positive timeoutMs');
  }

  return async function invoke(tool, args) {
    // NEVER record `tool` unchecked. The value arrives inside a socket frame
    // and the daemon's socket is reachable by any process on the machine, while
    // `tool` is sends:true in the event catalog on the grounds that it is an
    // enumerated primitive name. Unknown values are omitted (makeEvent drops
    // undefined), so the latency is still recorded — just anonymously.
    const name = isKnownTool(tool) ? tool : undefined;
    // Started BEFORE the call.start observe, so the sink's own cost (an
    // appendFileSync) is inside the measurement rather than excluded from it.
    // The number is meant to bound what the device took, from the daemon's
    // point of view, not to flatter it.
    const started = Date.now();
    // debug: off at the default level, so a scenario pays ONE append per device
    // call. Its value is bracketing — a daemon SIGKILLed mid-call leaves a
    // call.start with no call.end, which is the only trace a call that never
    // returned can possibly leave.
    observe({ level: 'debug', event: 'call.start', tool: name });
    try {
      // `call(...)` stays INSIDE the try. A `call` that throws synchronously —
      // or returns a non-thenable, which makes `p.catch` a TypeError — would
      // otherwise escape with no call.end recorded and no 'device'
      // classification, i.e. the one failure shape whose trace matters most
      // would be the one that leaves none.
      const p = call(tool, args);
      // Swallow the race loser's eventual settlement: once the timeout has won,
      // the underlying call is still running (it is NOT cancellable) and its
      // later rejection would surface as an unhandled rejection — which, in the
      // daemon, is a process exit.
      p.catch(() => {});
      const result = await Promise.race([
        p,
        scheduleTimeout(timeoutMs).then(() => {
          // The RAW `tool`, never the checked `name`: with an unknown tool
          // `name` is undefined and the message would read "undefined: the
          // mobile-mcp call did not respond ...", hiding which call hung at
          // exactly the moment a human needs to know. This is safe precisely
          // because it lands in `message`, which is sends:false in the event
          // catalog and never leaves the machine.
          const e = new Error(`${tool}: the mobile-mcp call did not respond within ${timeoutMs}ms`);
          e.kind = 'timeout';
          e.hint = 'the action may have partially executed on the device — verify state before retrying';
          throw e;
        }),
      ]);
      observe({ level: 'info', event: 'call.end', tool: name, ok: true, dur_ms: Date.now() - started });
      return result;
    } catch (err) {
      observe({
        // warn, not info. The daemon's stderr is a log file, not a terminal, so
        // this costs a human no noise and lands next to the adb/simctl output
        // that explains it.
        level: 'warn',
        event: 'call.end',
        tool: name,
        ok: false,
        // The envelope's own taxonomy, reused verbatim: a non-timeout failure
        // is exactly what client/deviceFail turns into kind 'device'.
        error_kind: err && err.kind === 'timeout' ? 'timeout' : 'device',
        dur_ms: Date.now() - started,
        // sends:false — an engine message can embed element labels, typed text
        // and filesystem paths. `err &&` because a caller can reject with a
        // falsy value, and reading .message off null here would replace an
        // ordinary failure with a TypeError.
        message: err && (err.message || String(err)),
      });
      throw err;
    }
  };
}

module.exports = { makeDeviceCall };
