'use strict';

// Pure streaming parser for `adb shell getevent -lt` output. Accumulates
// ABS_MT_POSITION_X/Y and BTN_TOUCH state, and on each SYN_REPORT emits a
// touch event ({kind:'down'|'move'|'up', t, x, y}) with coordinates scaled
// from raw input-device units to screen pixels. Hardware keys (EV_KEY KEY_*)
// are emitted as {kind:'key', t, key, state}. Timestamps are ms relative to
// tStart. No device access here — feed it raw stdout chunks.

const LINE_RE = /^\[\s*(\d+\.\d+)\]\s+\/dev\/input\/event\d+:\s+(EV_\w+)\s+(\w+)\s+(\S+)\s*$/;

class GeteventTouchParser {
  constructor({ emit, scaleX = 1, scaleY = 1, tStart = null }) {
    this._emit = emit;
    this._scaleX = scaleX;
    this._scaleY = scaleY;
    // tStart is the epoch (seconds) of the first event; when null it is
    // auto-detected from the first line seen so that t=0 maps to first event.
    // Use nullish coalescing so a literal tStart:0 is honored, not swallowed.
    this._tStart = tStart != null ? tStart : null;
    this._tail = '';
    this._x = null;
    this._y = null;
    this._lastX = 0;
    this._lastY = 0;
    this._touching = false;   // BTN_TOUCH state
    this._active = false;     // whether we've emitted a down for the current touch
    this._frameT = 0;
  }

  feedChunk(chunk) {
    const data = this._tail + chunk;
    const lines = data.split('\n');
    this._tail = lines.pop();
    for (const line of lines) this._consume(line);
  }

  _consume(line) {
    const m = line && line.match(LINE_RE);
    if (!m) return;
    const tSec = parseFloat(m[1]);
    if (this._tStart === null) this._tStart = tSec;
    const tMs = Math.round((tSec - this._tStart) * 1000);
    const type = m[2];
    const code = m[3];
    const value = m[4];
    this._frameT = tMs;

    if (type === 'EV_ABS' && code === 'ABS_MT_POSITION_X') {
      this._x = parseInt(value, 16);
      return;
    }
    if (type === 'EV_ABS' && code === 'ABS_MT_POSITION_Y') {
      this._y = parseInt(value, 16);
      return;
    }
    if (type === 'EV_KEY' && code === 'BTN_TOUCH') {
      this._touching = value.toUpperCase() === 'DOWN';
      return;
    }
    if (type === 'EV_KEY' && code.startsWith('KEY_')) {
      const state = value.toUpperCase() === 'DOWN' ? 'down' : 'up';
      this._emit({ kind: 'key', t: tMs, key: code.slice(4), state });
      return;
    }
    if (type === 'EV_SYN' && code === 'SYN_REPORT') {
      this._flushFrame();
    }
  }

  _flushFrame() {
    const x = this._scaled(this._x, this._scaleX);
    const y = this._scaled(this._y, this._scaleY);
    if (this._touching && !this._active) {
      this._active = true;
      this._lastX = x; this._lastY = y;
      this._emit({ kind: 'down', t: this._frameT, x, y });
    } else if (this._touching && this._active) {
      if (x !== this._lastX || y !== this._lastY) {
        this._lastX = x; this._lastY = y;
        this._emit({ kind: 'move', t: this._frameT, x, y });
      }
    } else if (!this._touching && this._active) {
      this._active = false;
      this._emit({ kind: 'up', t: this._frameT, x: this._lastX, y: this._lastY });
    }
  }

  _scaled(raw, scale) {
    return raw == null ? 0 : Math.round(raw * scale);
  }

  end() {
    if (this._tail) { this._consume(this._tail); this._tail = ''; }
  }
}

module.exports = { GeteventTouchParser };
