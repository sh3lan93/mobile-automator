'use strict';

const fs = require('fs');
const path = require('path');

const { memoryFile, lockPath } = require('./paths');
const { withLock } = require('./lock');
const { parseRunHistory, renderRunHistory, recordInModel, countEntries } = require('./history');

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

const HEADERS = {
  'run-history': '# Run History',
  'app-knowledge': '# App Knowledge',
  preferences: '# Preferences',
};

const DEFAULT_CAP = 8000;

// Filter a run-history markdown body down to a single scenario's `##` section.
// Keeps the top-of-file header lines (everything before the first `##`
// heading) and, if present, the matching scenario's heading + its note lines;
// drops every other scenario's section.
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

  _atomicWrite(file, contents) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = path.join(
      path.dirname(file),
      `.${path.basename(file)}.tmp.${process.pid}.${Date.now()}`
    );
    let fd;
    try {
      fd = fs.openSync(tmp, 'w');
      fs.writeFileSync(fd, contents);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(tmp, file);
    } catch (e) {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch (_) { /* ignore */ }
      }
      try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
      throw e;
    }
  }

  // Auto-harvest: fold a finalized result into the rolling run-history aggregate.
  recordRun(result = {}) {
    const scenarioId = result.scenario_id || 'unknown';
    const file = this._file('run-history');
    return withLock(lockPath(this.projectRoot), () => {
      const model = parseRunHistory(this._readRaw('run-history'));
      recordInModel(model, {
        scenarioId,
        statusLetter: statusLetter(result.status),
        notes: notesFromResult(result),
      });
      this._atomicWrite(file, renderRunHistory(model));
      return { scenarioId, runs: model.byScenario[scenarioId].runs.slice() };
    });
  }

  // Render the raw markdown `mauto memory show` emits: a one-line summary
  // comment (per-file entry counts + last-updated date) followed by the
  // requested file bodies. Read-only — no lock needed.
  render({ kind, scenario, cap = DEFAULT_CAP } = {}) {
    const names = kind ? [kind] : ['run-history', 'app-knowledge', 'preferences'];
    const summary = [];
    const sections = [];

    for (const name of ['run-history', 'app-knowledge', 'preferences']) {
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
