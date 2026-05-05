'use strict';

class HierarchyPoller {
  constructor({ bridge, intervalMs = 250, capacity = 40, now = () => Date.now() }) {
    this._bridge = bridge;
    this._intervalMs = intervalMs;
    this._capacity = capacity;
    this._now = now;
    this._buffer = [];
    this._timer = null;
  }

  start() {
    if (this._timer) return;
    const tick = async () => {
      try {
        const snap = await this._bridge.listElementsOnScreen();
        this._appendForTest({ t: this._now(), elements: snap.elements || [] });
      } catch (err) {
        // Swallow here; device-watchdog observes failures separately.
      }
    };
    this._timer = setInterval(tick, this._intervalMs);
    tick();
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  size() {
    return this._buffer.length;
  }

  findSnapshotBefore(t) {
    let best = null;
    for (const s of this._buffer) {
      if (s.t <= t && (!best || s.t > best.t)) best = s;
    }
    return best;
  }

  /** @private — used by tests to seed snapshots without polling */
  _appendForTest(snap) {
    this._buffer.push(snap);
    while (this._buffer.length > this._capacity) this._buffer.shift();
  }
}

module.exports = { HierarchyPoller };
