'use strict';

/**
 * BrowserWatchdog
 *
 * When the WebSocket loses its last connected client, start a 60-second
 * timer. If a client reconnects within the window, cancel the timer.
 * If the window elapses with no client, fire `onTimeout` exactly once.
 *
 * The lifecycle wires `onTimeout` to "treat as cancel" — the cleanup +
 * exit happen outside the watchdog.
 */
class BrowserWatchdog {
  constructor({
    wsCtx,
    onTimeout,
    timeoutMs = 60000,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  }) {
    this._wsCtx = wsCtx;
    this._onTimeout = onTimeout;
    this._timeoutMs = timeoutMs;
    this._setTimeoutFn = setTimeoutFn;
    this._clearTimeoutFn = clearTimeoutFn;
    this._timer = null;
    this._fired = false;
    this._started = false;
    this._onConnectHandler = null;
    this._onDisconnectHandler = null;
  }

  start() {
    if (this._started) return;
    this._started = true;

    this._onConnectHandler = () => {
      // A client (re)connected — cancel any pending timeout.
      if (this._timer !== null) {
        this._clearTimeoutFn(this._timer);
        this._timer = null;
      }
    };

    this._onDisconnectHandler = () => {
      // Only arm the timer if the last client left.
      if (this._wsCtx.clientCount() !== 0) return;
      // Don't re-arm if we've already fired or there is already a pending timer.
      if (this._fired) return;
      if (this._timer !== null) return;
      this._timer = this._setTimeoutFn(() => {
        this._timer = null;
        if (this._fired) return;
        this._fired = true;
        try {
          if (typeof this._onTimeout === 'function') this._onTimeout();
        } catch {
          // Swallow — the watchdog must not crash the host.
        }
      }, this._timeoutMs);
    };

    this._wsCtx.onConnect(this._onConnectHandler);
    this._wsCtx.onDisconnect(this._onDisconnectHandler);
  }

  stop() {
    if (this._timer !== null) {
      this._clearTimeoutFn(this._timer);
      this._timer = null;
    }
    // Detach: drop our handler refs so any captured closures release.
    this._onConnectHandler = null;
    this._onDisconnectHandler = null;
    this._started = false;
  }
}

module.exports = { BrowserWatchdog };
