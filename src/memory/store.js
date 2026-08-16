'use strict';

const fs = require('fs');
const path = require('path');

const { memoryFile, lockPath, KINDS, HEADERS } = require('./paths');
const { withLock } = require('../util/lock');
const { parseRunHistory, renderRunHistory, recordInModel, countEntries } = require('./history');
const { atomicWrite } = require('../util/atomic');
const { parseEntries, renderEntries, hasText } = require('./entries');

// Cross-session memory store. Mirrors ResultStore's one-shot-process,
// load-mutate-atomic-write shape, but the memory files are SHARED across runs
// (not keyed per-runId), so every read-modify-write goes through an advisory
// lock (see ./lock.js) to avoid lost updates.

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function statusLetter(status) {
  return status === 'passed' || status === 'pass' ? 'P' : 'F';
}

// Fold a run's typed observations into dated note lines for the aggregate.
function notesFromResult(result) {
  const date = todayISO();
  return (result.observations || []).map((o) => {
    const where = o.step_id ? ` (${o.step_id})` : '';
    return { date, text: `${o.type}${where}: ${o.message}` };
  });
}

const DEFAULT_CAP = 8000;

// Filter a run-history markdown body down to a single scenario's `##` section.
// Keeps the top-of-file header lines (everything before the first `##`
// heading) and, if present, the matching scenario's heading + its note lines;
// drops every other scenario's section.
//
// This is DELIBERATELY a string-level line filter, not a re-serialization
// from the parsed history model, mirroring the raw-preserving unfiltered
// render path above. Re-serializing from the model would silently drop any
// hand-edited line that doesn't fit the model's note shape — the files are
// designed to be hand-editable, so that data loss would be a behavior
// change, not a simplification. Do not "clean this up" into a model-based
// render without re-checking that invariant.
function filterScenario(md, scenario) {
  const lines = md.split('\n');
  const kept = [];
  let sawHeading = false;
  let inTarget = false;
  // `scenario` is user-supplied (the CLI's --scenario flag); escape regex
  // metacharacters so a value like "a(b" filters to zero matches instead of
  // throwing an uncaught SyntaxError out of this read-only render path.
  const safe = scenario.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingRe = new RegExp(`^##\\s+${safe}\\s+\\(last`);
  for (const line of lines) {
    const isHeading = /^##\s+/.test(line);
    if (isHeading) {
      sawHeading = true;
      inTarget = headingRe.test(line);
      if (!inTarget) continue;
      kept.push(line);
      continue;
    }
    if (!sawHeading) {
      // top-of-file header lines, before any scenario heading
      kept.push(line);
      continue;
    }
    if (inTarget) kept.push(line);
  }
  return kept.join('\n');
}

// Counts bullets for any file, reusing the history model for run-history.
function countEntriesFor(name, raw) {
  if (!raw) return 0;
  if (name === 'run-history') return countEntries(parseRunHistory(raw));
  // app-knowledge / preferences: one bullet per entry.
  return raw.split('\n').filter((l) => /^-\s+\[/.test(l)).length;
}

class MemoryStore {
  constructor({ projectRoot } = {}) {
    if (!projectRoot) throw new Error('MemoryStore requires a projectRoot');
    this.projectRoot = projectRoot;
    this.warnings = [];
  }

  _file(name) {
    return memoryFile(this.projectRoot, name);
  }

  // Read a memory file's raw text, or '' if absent. A read failure other than
  // ENOENT is preserved as a sidecar + warning (defensive parity with
  // ResultStore) and treated as empty so a write never clobbers unread bytes.
  _readRaw(name) {
    const file = this._file(name);
    try {
      return fs.readFileSync(file, 'utf8');
    } catch (e) {
      if (e && e.code === 'ENOENT') return '';
      return this._preserveCorrupt(file, e);
    }
  }

  _preserveCorrupt(file, err) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const sidecar = `${file}.corrupt.${ts}`;
    let preserved = false;
    try {
      fs.renameSync(file, sidecar);
      preserved = true;
    } catch (_) {
      /* best effort */
    }
    const where = preserved ? `preserved as ${path.basename(sidecar)}` : 'COULD NOT be preserved';
    this.warnings.push(
      `memory file ${file} was unreadable (${err.message}); ${where} and a fresh file was started`
    );
    return '';
  }

  // Delegates to the shared util (see src/util/atomic.js).
  _atomicWrite(file, contents) {
    atomicWrite(file, contents);
  }

  // Acquire the lock, read this kind's raw bytes, run the edit, and write ONLY when
  // the edit produced new contents. Single owner of the "under lock + write-when-changed"
  // invariant for every memory mutation.
  _editUnderLock(kind, edit) {
    return withLock(lockPath(this.projectRoot), () => {
      const { contents, result } = edit(this._readRaw(kind));
      if (contents != null) this._atomicWrite(this._file(kind), contents);
      return result;
    });
  }

  // Auto-harvest: fold a finalized result into the rolling run-history aggregate.
  recordRun(result = {}) {
    const scenarioId = result.scenario_id || 'unknown';
    return this._editUnderLock('run-history', (raw) => {
      const model = parseRunHistory(raw);
      recordInModel(model, {
        scenarioId,
        statusLetter: statusLetter(result.status),
        notes: notesFromResult(result),
      });
      return {
        contents: renderRunHistory(model),
        result: { scenarioId, runs: model.byScenario[scenarioId].runs.slice() },
      };
    });
  }

  // Agent-authored: append a durable [asserted] fact/preference under the lock.
  // Exact-match de-dupe (same text already present → skip). Assumes `text` is
  // already validated/sanitized by the verb handler.
  add(kind, text) {
    return this._editUnderLock(kind, (raw) => {
      const entries = parseEntries(raw);
      if (hasText(entries, text)) {
        return { contents: undefined, result: { kind, added: false, deduped: true } };
      }
      entries.push({ date: todayISO(), text });
      return { contents: renderEntries(kind, entries), result: { kind, added: true, deduped: false } };
    });
  }

  // The correction path: remove entries whose text contains `match`.
  forget(kind, match) {
    return this._editUnderLock(kind, (raw) => {
      const entries = parseEntries(raw);
      const kept = entries.filter((e) => !e.text.includes(match));
      const removed = entries.length - kept.length;
      return { contents: removed > 0 ? renderEntries(kind, kept) : null, result: { kind, removed } };
    });
  }

  // Render the raw markdown `mauto memory show` emits: a one-line summary
  // comment (per-file entry counts + last-updated date) followed by the
  // requested file bodies. Read-only — no lock needed.
  render({ kind, scenario, cap = DEFAULT_CAP } = {}) {
    const names = kind ? [kind] : KINDS;
    const summary = [];
    const sections = [];

    for (const name of KINDS) {
      const raw = this._safeRead(name);
      const count = countEntriesFor(name, raw);
      const updated = this._mtimeDate(name);
      summary.push(`${name}: ${count} entrie(s)${updated ? `, updated ${updated}` : ''}`);
    }

    for (const name of names) {
      let body = this._safeRead(name);
      if (!body) body = `${HEADERS[name] || `# ${name}`}\n(no entries yet)\n`;
      if (name === 'run-history' && scenario) body = filterScenario(body, scenario);
      sections.push(body.trim());
    }

    let out = `<!-- mauto memory · ${summary.join(' · ')} -->\n\n${sections.join('\n\n')}\n`;
    if (out.length > cap) {
      out = `${out.slice(0, cap)}\n… (truncated at ${cap} chars — narrow with --kind/--scenario)\n`;
    }
    return out;
  }

  // Read without the corruption sidecar side effect (render is read-only).
  _safeRead(name) {
    try {
      return fs.readFileSync(this._file(name), 'utf8');
    } catch (_) {
      return '';
    }
  }

  _mtimeDate(name) {
    try {
      return fs.statSync(this._file(name)).mtime.toISOString().slice(0, 10);
    } catch (_) {
      return null;
    }
  }
}

module.exports = { MemoryStore, todayISO, statusLetter };
