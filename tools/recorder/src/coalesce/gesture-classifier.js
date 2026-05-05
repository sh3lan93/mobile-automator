'use strict';

const TAP_MAX_MS = 300;
const LONG_PRESS_MIN_MS = 500;
const DOUBLE_TAP_WINDOW_MS = 300;
const DOUBLE_TAP_DISTANCE_PX = 30;
const SWIPE_MIN_DISTANCE_PX = 50;

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function direction(from, to) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

class GestureClassifier {
  constructor({ emit }) {
    this._emit = emit;
    this._activeDown = null;
    this._lastTap = null;
    this._pending = null;
  }

  feed(ev) {
    if (ev.kind === 'down') {
      this._activeDown = { t: ev.t, x: ev.x, y: ev.y, moved: false, lastX: ev.x, lastY: ev.y };
      return;
    }
    if (ev.kind === 'move') {
      if (this._activeDown) {
        this._activeDown.lastX = ev.x;
        this._activeDown.lastY = ev.y;
        if (dist([this._activeDown.x, this._activeDown.y], [ev.x, ev.y]) > 5) {
          this._activeDown.moved = true;
        }
      }
      return;
    }
    if (ev.kind === 'up') {
      if (!this._activeDown) return;
      const d = this._activeDown;
      const dur = ev.t - d.t;
      const movedDistance = dist([d.x, d.y], [ev.x, ev.y]);

      if (movedDistance >= SWIPE_MIN_DISTANCE_PX) {
        this._flushPending();
        this._emit({
          kind: 'swipe',
          t: d.t,
          from: [d.x, d.y],
          to: [ev.x, ev.y],
          direction: direction([d.x, d.y], [ev.x, ev.y]),
          duration_ms: dur,
        });
      } else if (dur >= LONG_PRESS_MIN_MS) {
        this._flushPending();
        this._emit({ kind: 'long_press', t: d.t, x: d.x, y: d.y, duration_ms: dur });
      } else if (dur <= TAP_MAX_MS) {
        // Possibly first half of a double-tap; buffer to see.
        if (this._lastTap && (d.t - this._lastTap.t) <= DOUBLE_TAP_WINDOW_MS &&
            dist([this._lastTap.x, this._lastTap.y], [d.x, d.y]) <= DOUBLE_TAP_DISTANCE_PX) {
          // Replace pending tap with double_tap.
          this._pending = null;
          this._emit({ kind: 'double_tap', t: this._lastTap.t, x: d.x, y: d.y });
          this._lastTap = null;
        } else {
          this._flushPending();
          this._pending = { kind: 'tap', t: d.t, x: d.x, y: d.y };
          this._lastTap = { t: d.t, x: d.x, y: d.y };
        }
      } else {
        // 300 < dur < 500 — call it a tap with note.
        this._flushPending();
        this._emit({ kind: 'tap', t: d.t, x: d.x, y: d.y, ambiguous_duration_ms: dur });
      }
      this._activeDown = null;
    }
  }

  flush() {
    this._flushPending();
  }

  _flushPending() {
    if (this._pending) {
      this._emit(this._pending);
      this._pending = null;
    }
  }
}

module.exports = { GestureClassifier };
