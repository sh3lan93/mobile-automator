'use strict';

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

module.exports = { parseGeteventLine, GeteventStreamParser };
