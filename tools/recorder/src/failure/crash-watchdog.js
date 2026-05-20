'use strict';

/**
 * CrashWatchdog
 *
 * Polls a bridge for a native-app crash report on a fixed interval. When the
 * bridge surfaces a structured crash payload (truthy + non-empty `log` field),
 * fires `onCrash({ crash })` exactly once and "parks" itself: subsequent ticks
 * are ignored until the caller invokes `resume()`. This mirrors the
 * orchestrator handshake — the user picks relaunch / save / discard before the
 * watchdog is allowed to detect a new crash.
 *
 * The watchdog never calls `process.exit` and never touches the artifacts
 * store. All side effects belong to the orchestrator.
 *
 * Timers are injected (`setIntervalFn` / `clearIntervalFn`) so tests can drive
 * the poll loop deterministically with jest fake timers.
 */
class CrashWatchdog {
  constructor({
    bridge,
    onCrash,
    intervalMs = 5000,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
  } = {}) {
    this._bridge = bridge;
    this._onCrash = onCrash;
    this._intervalMs = intervalMs;
    this._setInterval = setIntervalFn;
    this._clearInterval = clearIntervalFn;
    this._handle = null;
    this._parked = false;
  }

  start() {
    if (this._handle !== null) return; // idempotent
    this._handle = this._setInterval(() => {
      // Schedule the async poll but don't await it — interval callbacks must
      // return synchronously. Errors are swallowed inside _poll.
      this._poll();
    }, this._intervalMs);
  }

  stop() {
    if (this._handle === null) return;
    this._clearInterval(this._handle);
    this._handle = null;
  }

  /**
   * Clear the "parked" flag so a fresh crash payload can fire `onCrash` again.
   * Called by the orchestrator after the user has acknowledged the crash (e.g.
   * after a relaunch).
   */
  resume() {
    this._parked = false;
  }

  async _poll() {
    if (this._parked) return;

    let payload;
    try {
      payload = await this._bridge.getCrash();
    } catch {
      // Bridge transport hiccup — swallow and keep polling.
      return;
    }

    if (!isCrashPayload(payload)) return;

    // Park first so a synchronous re-entry (or an onCrash that throws) can't
    // cause a duplicate fire.
    this._parked = true;
    try {
      if (typeof this._onCrash === 'function') {
        this._onCrash({ crash: payload });
      }
    } catch {
      // Swallow — the watchdog must not crash the host.
    }
  }
}

function isCrashPayload(p) {
  return Boolean(p) && typeof p === 'object' && typeof p.log === 'string' && p.log.length > 0;
}

module.exports = { CrashWatchdog };
