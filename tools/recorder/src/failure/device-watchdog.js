'use strict';

/**
 * DeviceWatchdog
 *
 * Rolling-window failure detector. Callers (typically the hierarchy poller)
 * invoke `observeFailure(err)` on every capture rejection and `observeSuccess()`
 * on every successful tick. When `threshold` failures accumulate within the
 * trailing `windowMs` time window, `onTrip({ deviceLabel, reason })` fires
 * exactly once.
 *
 * The watchdog is purely an event-driven state machine — it does not own any
 * timers, does not call `process.exit`, and does not touch the artifacts store.
 * Side effects (cleanup, broadcast, exit code) belong to the orchestrator.
 *
 * Time is driven by an injected `now()` function so tests can control the
 * rolling window deterministically without leaning on jest fake timers.
 */
class DeviceWatchdog {
  constructor({
    onTrip,
    deviceLabel,
    windowMs = 5000,
    threshold = 3,
    now = () => Date.now(),
  } = {}) {
    this._onTrip = onTrip;
    this._deviceLabel = deviceLabel;
    this._windowMs = windowMs;
    this._threshold = threshold;
    this._now = now;
    this._failures = [];
    this._fired = false;
  }

  /**
   * Clear the failure buffer. Called by the capture-success branch so a
   * single transient failure following a successful tick cannot, on its own,
   * push an older buffer over the threshold.
   */
  observeSuccess() {
    this._failures = [];
  }

  /**
   * Record a capture failure. Prunes failures older than `windowMs` from the
   * current time and fires `onTrip` once if the surviving buffer meets the
   * threshold.
   *
   * @param {Error} [err] - optional failure cause; surfaced in the reason
   *                        string if present.
   */
  observeFailure(err) {
    if (this._fired) return;

    const t = this._now();
    this._failures.push(t);

    const cutoff = t - this._windowMs;
    // Drop timestamps that fell out of the trailing window.
    while (this._failures.length > 0 && this._failures[0] < cutoff) {
      this._failures.shift();
    }

    if (this._failures.length < this._threshold) return;

    this._fired = true;
    const reason = `${this._threshold} consecutive capture failures within ${this._windowMs}ms${
      err && err.message ? ` (last: ${err.message})` : ''
    }`;
    try {
      if (typeof this._onTrip === 'function') {
        this._onTrip({ deviceLabel: this._deviceLabel, reason });
      }
    } catch {
      // Swallow — the watchdog must not crash the host.
    }
  }
}

module.exports = { DeviceWatchdog };
