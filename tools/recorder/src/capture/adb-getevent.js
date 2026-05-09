'use strict';

const { spawn: defaultSpawn } = require('child_process');

const KEY_RE = /^\[\s*(\d+\.\d+)\]\s+\/dev\/input\/event\d+:\s+EV_KEY\s+KEY_(\w+)\s+(DOWN|UP)\s*$/;

function parseGeteventLine(line) {
  if (!line) return null;
  const m = line.match(KEY_RE);
  if (!m) return null;
  return { t_seconds: parseFloat(m[1]), key: m[2], state: m[3].toLowerCase() };
}

class GeteventStreamParser {
  constructor({ emit, tStart = 0 }) {
    this._emit = emit;
    this._tStart = tStart;
    this._tail = '';
  }

  feedChunk(chunk) {
    const data = this._tail + chunk;
    const lines = data.split('\n');
    this._tail = lines.pop();
    for (const line of lines) {
      const parsed = parseGeteventLine(line);
      if (!parsed) continue;
      const tMs = Math.round((parsed.t_seconds - this._tStart) * 1000);
      this._emit({ kind: 'key', t: tMs, key: parsed.key, state: parsed.state });
    }
  }

  end() {
    if (this._tail) {
      const parsed = parseGeteventLine(this._tail);
      if (parsed) {
        const tMs = Math.round((parsed.t_seconds - this._tStart) * 1000);
        this._emit({ kind: 'key', t: tMs, key: parsed.key, state: parsed.state });
      }
      this._tail = '';
    }
  }
}

// Wraps a long-running `adb shell getevent -lt` child process so the recorder
// can capture Android hardware keys (BACK / HOME / VOLUME_*) that leave no
// trace in the screen-recording pipeline. The supplement is platform-gated:
// on iOS Simulator it self-disables (Apple has no equivalent stream), and on
// Android it survives `adb` not being on PATH by warning once and disabling
// rather than crashing the recorder.
class AdbGeteventSupplement {
  constructor({ platform, emit, tStart = 0, spawn = defaultSpawn, warn = console.warn } = {}) {
    this._platform = platform;
    this._emit = emit;
    this._tStart = tStart;
    this._spawn = spawn;
    this._warn = warn;
    this._proc = null;
    this._parser = null;
    this._disabled = platform !== 'android';
    this._warned = false;
  }

  start() {
    if (this._disabled) return;
    let proc;
    try {
      proc = this._spawn('adb', ['shell', 'getevent', '-lt']);
    } catch (err) {
      this._handleSpawnError(err);
      return;
    }
    this._proc = proc;
    this._parser = new GeteventStreamParser({ emit: this._emit, tStart: this._tStart });
    if (typeof proc.on === 'function') {
      proc.on('error', (err) => this._handleSpawnError(err));
      proc.on('close', () => { if (this._parser) this._parser.end(); });
    }
    if (proc.stdout && typeof proc.stdout.on === 'function') {
      if (typeof proc.stdout.setEncoding === 'function') proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk) => this._parser.feedChunk(String(chunk)));
    }
  }

  _handleSpawnError(err) {
    if (err && err.code === 'ENOENT' && !this._warned) {
      this._warn('adb: command not found; hardware key events disabled');
      this._warned = true;
    }
    this._disabled = true;
    this._proc = null;
  }

  stop() {
    if (this._proc) {
      try { this._proc.kill(); } catch (_) { /* already exited */ }
      this._proc = null;
    }
    if (this._parser) {
      this._parser.end();
      this._parser = null;
    }
  }

  get disabled() { return this._disabled; }
}

module.exports = { parseGeteventLine, GeteventStreamParser, AdbGeteventSupplement };
