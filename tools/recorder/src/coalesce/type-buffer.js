'use strict';

const ENTER_LABELS = new Set(['enter', 'return', 'done', 'search', 'send', 'go', '↵']);

function isEnterKey(key) {
  if (key === '\n') return true;
  if (typeof key !== 'string') return false;
  return ENTER_LABELS.has(key.toLowerCase());
}

class TypeBuffer {
  constructor({ emit, silenceTimeoutMs = 1500, now = () => Date.now() }) {
    this._emit = emit;
    this._silenceMs = silenceTimeoutMs;
    this._nowFn = now;
    this._field = null;
    this._buf = [];
    this._startedAt = null;
    this._lastEventAt = null;
  }

  observeFocus({ t, field }) {
    if (this._field && (!field || field.id !== this._field.id)) {
      this._commit();
    }
    this._field = field || null;
  }

  observeKeyboardTap({ t, key }) {
    if (!this._field) return;
    if (isEnterKey(key)) {
      // Enter-shaped key: flush whatever's buffered, but do NOT append the
      // label/control-char to the value. Real keyboards surface this key as
      // 'Enter' / 'Return' / 'Done' / 'Search' / 'Send' / 'Go' / '↵' (varies
      // by IME and form context); '\n' is the synthetic test shape.
      this._commit();
      return;
    }
    this._appendKey(t, key);
  }

  tick() {
    if (this._startedAt && (this._nowFn() - this._lastEventAt) >= this._silenceMs) {
      this._commit();
    }
  }

  flush() {
    this._commit();
  }

  /** @private */
  _setNowForTest(value) {
    this._nowFn = () => value;
  }

  _appendKey(t, key) {
    if (this._startedAt === null) this._startedAt = t;
    this._lastEventAt = this._nowFn();
    this._buf.push(key);
  }

  _commit() {
    if (!this._field || this._buf.length === 0) {
      this._buf = [];
      this._startedAt = null;
      this._lastEventAt = null;
      return;
    }
    this._emit({
      kind: 'type',
      t: this._startedAt,
      value: this._buf.join(''),
      field_id: this._field.id,
      field_label: this._field.label,
      sensitive: !!this._field.sensitive,
    });
    this._buf = [];
    this._startedAt = null;
    this._lastEventAt = null;
  }
}

module.exports = { TypeBuffer };
