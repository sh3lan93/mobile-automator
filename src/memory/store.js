'use strict';

const fs = require('fs');
const path = require('path');

const { memoryFile, lockPath } = require('./paths');
const { withLock } = require('./lock');
const { parseRunHistory, renderRunHistory, recordInModel } = require('./history');

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
}

module.exports = { MemoryStore, todayISO, statusLetter };
