'use strict';

// The failure-path crash check.
//
// Runs ONLY after an action has already failed, or after `mauto elements`
// returned an empty list. Never after a successful action: a round trip on
// every `mauto tap` would put a device call on the hot path, whereas checking
// after a failure costs nothing in the common case and answers the exact
// question that is otherwise unanswerable — "did the app die, or did the button
// move?".
//
// THE CONTRACT (see the slice-4 plan's "absent-versus-empty problem"): three
// states, not two.
//
//   crashes: [ … ]   we asked and the device reported crashes
//   crashes: []      we asked and the device reported none  — a POSITIVE claim
//   (no key)         we could not ask, or could not attribute — UNKNOWN
//
// Emitting `[]` when the probe failed, timed out or had no watermark would be
// this slice's own bug with the sign flipped: the tool would confidently tell
// the agent the app is fine when it has no idea. So the probe attaches a key it
// earned, or attaches nothing at all.
//
// It is TOTAL. It never throws, never rejects, and never alters ok, error or
// schema_version. An observability failure must not rewrite the caller's error.
//
// SIGNATURE, and why it differs from the plan's own "Interfaces" prose: that
// prose sketched probeCrashes deriving the watermark internally (via
// readHandle(projectRoot)), but its own test file passes `watermark` and
// `sinks` explicitly and sets `projectRoot` to the nonexistent path '/nope'.
// The tests are the contract: this module takes `watermark` as a plain value
// and never touches the filesystem itself, which is what makes it a pure,
// synchronously-testable function. `src/cli.js` already owns a
// `sessionWatermark(projectRoot)` helper (added with the `crash` verb, reusing
// the same `readHandle`-backed logic `handleCrashList` needs) — connectBridge
// calls that and passes the result in, rather than this module growing a second
// copy of "how do we find the session start time".
//
// ENVELOPE SHAPE ON FAILURE: attaching `data.crashes` to a `fail()` envelope is
// not a new envelope shape. `src/output/envelope.js`'s `fail(kind, message,
// hint, data)` has taken an optional trailing `data` since before this slice
// (used by `init --agent all`'s per-host ok/failed map) — `data` is included
// only when given, so the common fail shape is unchanged for every verb that
// doesn't pass one. No lint guard or schema asserts a fixed key set for a
// failure envelope (checked: no envelope-shape guard exists in tests/lint or
// tests/unit). This module uses that existing extension point rather than
// inventing one.
//
// THE ok:true / EMPTY-`elements` ASYMMETRY IS INTENTIONAL, AND DELIBERATELY NOT
// SILENT. On failure, `data` is an object (or absent) and gaining a `crashes`
// key is additive. On the `elements` ok:true path `data` IS the elements array
// — the verb's whole contract — so grafting a `crashes` key onto it would
// corrupt that contract for every consumer expecting `data` to stay an array.
// So on that path the result reaches the caller ONLY as a hint, on BOTH
// determined outcomes (crash found, or confirmed clear) — not only when a
// crash is found. Signalling only the "found" case would make an earned-clear
// probe look identical to a probe that never ran, which is exactly the
// UNKNOWN state this module exists to keep distinct from EARNED-EMPTY. Only
// the genuinely undetermined case (skipped, failed, timed out, unscoped)
// leaves the envelope untouched.

const { crashTimestampMs } = require('./crash-model');
const { observeEnabled } = require('../observe/gate');
const { record } = require('../observe/recorder');

// The probe's own budget, deliberately far below the daemon's per-call timeout
// (session-daemon.js's DAEMON_CALL_TIMEOUT_MS, 25s). Inheriting that would add
// up to 25 seconds to a verb that has ALREADY failed, for a courtesy lookup the
// caller did not ask for.
const CRASH_PROBE_TIMEOUT_MS = 3000;

// `mauto devices` returns a bare array through the same connectBridge seam, so
// the empty-list trigger would fire on "nothing connected" and then try to
// probe a device that does not exist.
const PROBE_EXEMPT_VERBS = new Set(['devices']);

// Failure kinds that can plausibly mean "the app died". invalid_input is a bad
// flag, target_not_found/environment/internal never reached (or never
// involved) the device — none of them are worth a device round trip.
const PROBE_KINDS = new Set(['device', 'timeout']);

function shouldProbe({ envelope, verb } = {}) {
  if (!envelope || typeof envelope !== 'object') return false;
  if (PROBE_EXEMPT_VERBS.has(verb)) return false;
  if (envelope.ok === false) {
    return PROBE_KINDS.has(envelope.error && envelope.error.kind);
  }
  // The silent symptom: the app is gone, so the view hierarchy is empty and the
  // verb still succeeds. Named by verb rather than by shape — relying on "only
  // `elements` returns a bare array" would be relying on an accident.
  return verb === 'elements' && Array.isArray(envelope.data) && envelope.data.length === 0;
}

function crashHint(crashes) {
  const process = crashes[0] && crashes[0].process;
  const who = process ? ` (${process})` : '';
  const id = crashes[0] && crashes[0].id;
  const how = id ? ` Run \`mauto crash get ${id}\` for the report.` : ' Run `mauto crash list`.';
  return `The app under test crashed during this session${who}: ${crashes.length} crash report(s).${how}`;
}

// The confirmatory half of the three-state contract on the ok:true path, where
// there is no `data` slot to carry an earned-empty result.
const NO_CRASH_HINT =
  'Checked for an app crash since the session started: none found — the empty result looks genuine.';

function amendHint(envelope, note) {
  envelope.hint = envelope.hint ? `${note} ${envelope.hint}` : note;
}

// Shared sentinel so a caller racing withDeadline() can tell "the deadline won"
// apart from "the bridge resolved with this exact value" — a module-level
// constant rather than a fresh Symbol() per call, so the identity check below
// actually matches.
const TIMED_OUT = Symbol('mauto.probe.timeout');

// Race a promise against a deadline. The timer is deliberately left REF'D
// (not unref()'d): the promise on the other side of this race is, by
// definition, a HUNG bridge call that will never settle on its own — that is
// the exact case this deadline exists to catch. If the timer were unref'd and
// nothing else happened to be keeping the event loop alive (a one-shot verb
// whose connectBridge socket handling has already torn down, say), Node would
// consider the loop empty and exit *before the timer ever fires*: the race
// never settles, probeCrashes never resolves, connectBridge's `await
// probeCrashes(...)` never returns, and the CLI exits 0 with no output —
// silently swallowing the very device failure this module exists to surface.
// That is strictly worse than never having built this deadline. Keeping the
// timer ref'd costs nothing it was trying to save: the `.finally(() =>
// clearTimeout(timer))` below already guarantees the timer cannot outlive the
// race on either branch, which is the actual guarantee "don't leave a live
// timer behind" was after.
function withDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

async function probeCrashes({
  bridge,
  envelope,
  verb,
  projectRoot,
  env = process.env,
  watermark,
  sinks,
  timeoutMs = CRASH_PROBE_TIMEOUT_MS,
} = {}) {
  const recordOpts = { projectRoot, env, sinks };
  try {
    if (!observeEnabled(env)) return;
    if (!bridge || typeof bridge.listCrashes !== 'function') return;
    if (!shouldProbe({ envelope, verb })) return;

    if (watermark == null) {
      // No session handle (or a caller that passed none) means nothing to
      // attribute against. An iOS DiagnosticReports file from last Tuesday is
      // not evidence about this step, so say nothing rather than say something
      // wrong.
      record({ level: 'debug', src: 'cli', event: 'crash.probe_unscoped', verb }, recordOpts);
      return;
    }
    const sinceMs = Date.parse(watermark);

    let raw;
    try {
      raw = await withDeadline(
        Promise.resolve().then(() => bridge.listCrashes()),
        timeoutMs
      );
    } catch (err) {
      record(
        {
          level: 'warn',
          src: 'cli',
          event: 'crash.probe_failed',
          verb,
          message: (err && err.message) || String(err),
        },
        recordOpts
      );
      return;
    }
    if (raw === TIMED_OUT) {
      record({ level: 'warn', src: 'cli', event: 'crash.probe_timeout', verb, dur_ms: timeoutMs }, recordOpts);
      return;
    }

    const crashes = (Array.isArray(raw) ? raw : []).filter((c) => {
      const ms = crashTimestampMs(c);
      return ms != null && Number.isFinite(sinceMs) && ms >= sinceMs;
    });

    record(
      {
        level: crashes.length > 0 ? 'warn' : 'info',
        src: 'cli',
        event: crashes.length > 0 ? 'crash.detected' : 'crash.probe_clear',
        verb,
        crash_count: Number.isFinite(crashes.length) ? crashes.length : undefined,
        // app_id and message are sends:false — a crashed process name is an
        // unreleased product name and a stack excerpt is free text.
        app_id: (crashes[0] && crashes[0].process) || undefined,
      },
      recordOpts
    );

    if (envelope.ok === false) {
      // EARNED result: we asked, the device answered, we attribute the answer.
      // See the module comment above for why this key is safe to add.
      envelope.data = { ...(envelope.data || {}), crashes };
      if (crashes.length > 0) amendHint(envelope, crashHint(crashes));
    } else {
      // ok:true only happens for the empty-`elements` trigger. `data` stays the
      // elements array untouched; the result is prose-only, on BOTH determined
      // outcomes. See the module comment above.
      amendHint(envelope, crashes.length > 0 ? crashHint(crashes) : NO_CRASH_HINT);
    }
  } catch (err) {
    // Total by construction. A broken probe must never turn "tap failed:
    // element not found" into "tap failed AND crash probing is broken" — that
    // buries the error the caller actually needs.
    try {
      record(
        {
          level: 'warn',
          src: 'cli',
          event: 'crash.probe_failed',
          verb,
          message: (err && err.message) || String(err),
        },
        recordOpts
      );
    } catch (_) {
      /* record() is already total; this is belt and suspenders */
    }
  }
}

module.exports = {
  probeCrashes,
  shouldProbe,
  CRASH_PROBE_TIMEOUT_MS,
  PROBE_EXEMPT_VERBS,
  PROBE_KINDS,
};
