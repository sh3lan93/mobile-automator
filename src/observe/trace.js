'use strict';

// The READ side of a run trace: turn the NDJSON a run left behind into the
// handful of facts `result finalize` is allowed to state as measured.
//
// Deliberately separate from the sink that writes it, because the two have
// opposite constraints. Writing happens on every verb and must be as close to
// free as an append can be. Reading happens once, in finalize, and can afford
// to parse the whole file. Nothing here is ever called on the hot path — which
// is also why the directory prune lives here rather than in the sink.

const realFs = require('fs');
const path = require('path');

const { atCap } = require('./sinks/file');
const { logsDir, runTracePath, RUN_TRACE_PREFIX } = require('./paths');

// A device failure in the envelope's own taxonomy. `deviceFail` (src/cli.js) is
// the ONLY producer of these two kinds, so counting them needs no list of which
// verbs are device verbs — a list that would have to be maintained by hand
// alongside connectBridge and would be wrong the first time someone forgot.
const DEVICE_FAILURE_KINDS = new Set(['device', 'timeout']);

// How many run traces .logs/ keeps. See the plan's bounded-measurement analysis:
// a trace is capped individually, but the DIRECTORY is one file per run forever.
const KEEP_RUN_TRACES = 20;

// Parse NDJSON leniently. A trailing partial line is NORMAL, not corruption: a
// SIGKILLed process can be interrupted mid-append, and the trace of a run that
// died is the trace most worth reading. Unparseable lines are skipped.
function parseTrace(text) {
  const events = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e === 'object') events.push(e);
    } catch (_) {
      /* partial or corrupt line; the rest of the trace is still evidence */
    }
  }
  return events;
}

function readTrace(tracePath, { fs = realFs } = {}) {
  if (!tracePath) return null;
  let text;
  try {
    text = fs.readFileSync(tracePath, 'utf8');
  } catch (_) {
    // No trace for this run: an ordinary, expected state (MAUTO_RUN_ID unset,
    // logging silenced, no workspace, or an id that could not name a file).
    return null;
  }
  return { events: parseTrace(text), truncated: atCap(tracePath, { fs }) };
}

function millis(event) {
  const t = event && event.ts ? Date.parse(event.ts) : NaN;
  return Number.isFinite(t) ? t : null;
}

// The facts a trace can PROVE, and deliberately nothing else.
//
// Absent by design: per-step attempt counts. The design asks for "retry counts
// … counted from repeated verb events against the same target", and the trace
// has no target — `--at 100,250` is not a recorded field and must not become
// one, because coordinates and element labels are exactly the free text the
// redaction catalog exists to keep off the wire. Step boundaries could be
// inferred from where the `result add-step` events fall, but that is only sound
// if the agent records each step immediately after performing it; an agent that
// batches its add-step calls at the end would file every device call under step
// one. Silently mis-attributing retries is the same confident wrongness this
// slice exists to remove.
//
// So this counts what needs no inference — run-wide device failures, each of
// which is an attempt that did not take. finalize COMPARES that against what
// the agent said rather than overwriting the per-step numbers.
function deriveRun(trace) {
  if (!trace || !Array.isArray(trace.events) || trace.events.length === 0) return null;

  const truncated = Boolean(trace.truncated);
  const device_failures = trace.events.filter(
    (e) => e.event === 'verb.end' && e.ok === false && DEVICE_FAILURE_KINDS.has(e.error_kind)
  ).length;
  const failure_screenshots = trace.events
    .filter((e) => e.event === 'screenshot.on_failure' && typeof e.path === 'string')
    .map((e) => e.path);

  // reduce, not Math.min(...stamps): a 1 MiB trace is a few thousand lines
  // today, but spreading an array into a call is an argument-count limit
  // waiting to be hit by a future, larger cap.
  let first = null;
  let last = null;
  for (const event of trace.events) {
    const t = millis(event);
    if (t === null) continue;
    if (first === null || t < first) first = t;
    if (last === null || t > last) last = t;
  }

  // Two stamps or nothing. A single-event trace spans zero time, and writing 0
  // down as a MEASURED duration would be a confident lie where "we did not
  // measure" is the truth — finalize falls back to the reported value.
  const measurable = first !== null && last !== null && last > first;

  return {
    // Milliseconds to seconds: the trace's resolution is 1ms, and rounding to
    // whole seconds would report every fast run as 0.
    duration_seconds: measurable ? (last - first) / 1000 : null,
    trace_events: trace.events.length,
    device_failures,
    trace_truncated: truncated,
    failure_screenshots,
  };
}

// Keep the `keep` most recent run traces; delete the rest.
//
// Called at finalize and NOWHERE else. Off the hot path — a readdir per
// `mauto tap` would put directory scanning inside the tightest loop the tool
// has — and finalize is the only moment a run is known to be over. Keying the
// prune on OTHER runs' traces also handles the crashed-run case: a run that
// never finalized leaves an orphan, which is simply an older file the next
// successful finalize sweeps up.
//
// The trace of the run being finalized is always excluded. Deleting it there is
// the one option that is clearly wrong: it is the evidence behind every number
// finalize just wrote, destroyed at exactly the moment someone starts asking
// where duration_seconds came from.
//
// Deletion is confined to `run-*.ndjson` in the resolved logs dir — files this
// tool created, under a name it owns. Best-effort throughout: pruning a log
// directory must never be the reason a finalize fails.
function pruneRunTraces(projectRoot, { keep = KEEP_RUN_TRACES, except, env = process.env, fs = realFs } = {}) {
  try {
    const dir = logsDir(projectRoot, env);
    const exceptPath = except ? runTracePath(projectRoot, except, env) : null;
    const exceptName = exceptPath ? path.basename(exceptPath) : null;

    const traces = fs
      .readdirSync(dir)
      .filter((n) => n.startsWith(RUN_TRACE_PREFIX) && n.endsWith('.ndjson') && n !== exceptName)
      .map((name) => {
        const full = path.join(dir, name);
        let mtime = 0;
        try {
          mtime = fs.statSync(full).mtimeMs;
        } catch (_) {
          /* raced with another process; treat as oldest */
        }
        return { full, mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);

    // keep - 1: the run being finalized is excluded from `traces` above and
    // occupies one of the retained slots.
    let removed = 0;
    for (const trace of traces.slice(Math.max(0, keep - 1))) {
      try {
        fs.unlinkSync(trace.full);
        removed += 1;
      } catch (_) {
        /* raced, or already gone */
      }
    }
    return removed;
  } catch (_) {
    // No .logs/ yet, or an unreadable directory. Pruning is never load-bearing.
    return 0;
  }
}

module.exports = { readTrace, deriveRun, pruneRunTraces, KEEP_RUN_TRACES, DEVICE_FAILURE_KINDS };
