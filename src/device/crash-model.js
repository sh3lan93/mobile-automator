'use strict';

// Agnostic crash-report model, in the shape of device-model.js / element-model.js.
//
// It exists because the engine's payload is not mauto's contract. mobile-mcp's
// mobile_list_crashes delegates to `mobilecli`, a separately-versioned Go binary
// that reaches us TRANSITIVELY (through mobilewright) rather than as a pin in our
// package.json, so its CrashReport struct is not something this repo can hold
// still. Normalizing here means a key rename upstream costs one line in one
// file instead of a silently-empty crash list at the call sites.
//
// The one thing this module never does is invent a field. An unreadable id or
// time is `null`, and callers treat null-timed reports as UNATTRIBUTED rather
// than assuming them recent or assuming them stale — see the "absent-versus-
// empty problem" section of the slice-4 plan.

// Plausible spellings for each field, most-likely first. A list rather than a
// single key because "which spelling does mobilecli use this month" is exactly
// the fact we refuse to depend on.
const ID_KEYS = ['id', 'crashId', 'crash_id', 'reportId', 'name'];
const PROCESS_KEYS = ['processName', 'process', 'packageName', 'bundleId', 'bundle_id', 'appId'];
const TIME_KEYS = ['timestamp', 'time', 'date', 'createdAt', 'created_at'];

function firstString(obj, keys) {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return null;
}

function firstValue(obj, keys) {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

// Accepts a bare array, a { crashes: [...] } envelope, or the JSON text of
// either — mobile-mcp stringifies its payload and parseToolResult's text
// fallback can hand it to us unparsed.
function toArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      return toArray(JSON.parse(raw));
    } catch (_) {
      return [];
    }
  }
  if (raw && typeof raw === 'object') {
    for (const k of ['crashes', 'reports', 'data', 'items']) {
      if (Array.isArray(raw[k])) return raw[k];
    }
  }
  return [];
}

function normalizeCrashes(raw) {
  return toArray(raw)
    .filter((c) => c && typeof c === 'object' && !Array.isArray(c))
    .map((c) => ({
      id: firstString(c, ID_KEYS),
      process: firstString(c, PROCESS_KEYS),
      timestamp: (() => {
        const t = firstValue(c, TIME_KEYS);
        return t == null ? null : String(t);
      })(),
    }));
}

// Epoch milliseconds for a normalized crash, or null when the time cannot be
// read. Never 0 and never NaN: 0 sorts before every watermark and NaN compares
// false against every watermark, so BOTH would silently drop the report. A
// dropped crash report is the confident wrong answer this slice exists to
// prevent, so unreadable is reported as unreadable.
function crashTimestampMs(crash) {
  const t = crash && crash.timestamp;
  if (t == null || t === '') return null;
  if (typeof t === 'number' && Number.isFinite(t)) {
    // Heuristic shared with every log tool: a 10-digit value is seconds.
    return t < 1e12 ? Math.round(t * 1000) : Math.round(t);
  }
  const s = String(t).trim();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    return n < 1e12 ? n * 1000 : n;
  }
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? parsed : null;
}

module.exports = { normalizeCrashes, crashTimestampMs };
