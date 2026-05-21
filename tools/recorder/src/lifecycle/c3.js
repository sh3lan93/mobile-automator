'use strict';

const fs = require('fs');
const path = require('path');
const { createTcpListener: realCreateTcpListener } = require('../c3/tcp-listener');

/**
 * Default 10-second handshake-timeout window. After binding the listener we
 * wait this long for an SDK to perform a v1 handshake; if nothing arrives, we
 * broadcast a fallback prompt to the GUI so the operator can choose between
 * dropping back to Mode B (device-driven capture) or cancelling.
 */
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;

/**
 * C3 lifecycle: bind a loopback TCP listener, publish discovery channels
 * (port file + env var), and stream events into the artifact store. C3 events
 * are pre-coalesced by the SDK — they go straight to `store.appendEvent`
 * without the gesture-classifier / type-buffer pipeline that Mode B needs.
 *
 * If no handshake arrives within `handshakeTimeoutMs` (default 10s), we
 * broadcast `{type:'c3-fallback-prompt', reason:'sdk_timeout'}` and wait for
 * the operator's `{type:'c3-fallback-choice', choice:'use_mode_b'|'cancel'}`:
 *
 *   • use_mode_b → tear down the listener, delegate to startModeB, resolve
 *     with whatever exit code that path produces.
 *   • cancel     → broadcast `recording-cancelled`, cleanup the bundle,
 *     resolve with exit code 130 (SIGINT convention).
 *
 * `deps` lets tests inject `createTcpListener`, `setTimeout`/`clearTimeout`,
 * and `startModeB` so the orchestration is exercisable without real sockets.
 */
async function startC3({
  store,
  wsCtx,
  httpSrv, // eslint-disable-line no-unused-vars
  sessionId,
  projectRoot,
  platform,
  appPackage,
  opts = {},
  deps = {},
} = {}) {
  const _createTcpListener = deps.createTcpListener || realCreateTcpListener;
  const _setTimeout = deps.setTimeout || setTimeout;
  const _clearTimeout = deps.clearTimeout || clearTimeout;
  const _startModeB = deps.startModeB || require('./mode-b').startModeB;
  const handshakeTimeoutMs =
    typeof deps.handshakeTimeoutMs === 'number'
      ? deps.handshakeTimeoutMs
      : DEFAULT_HANDSHAKE_TIMEOUT_MS;

  const listener = await _createTcpListener({
    sessionId,
    expectedPlatform: platform,
    expectedAppId: appPackage || undefined,
  });

  // ---- Discovery channels --------------------------------------------------

  const portFilePath = path.join(
    projectRoot,
    'mobile-automator',
    '.recorder',
    sessionId,
    'recorder-c3.port',
  );
  fs.mkdirSync(path.dirname(portFilePath), { recursive: true });
  fs.writeFileSync(
    portFilePath,
    JSON.stringify({ port: listener.port, v: 1, session_id: sessionId }),
  );
  process.env.MOBILE_AUTOMATOR_RECORDER_C3_PORT = String(listener.port);

  let handshaken = false;
  let resolved = false;
  let resolveExit;
  const exitPromise = new Promise((res) => { resolveExit = res; });

  function cleanupDiscovery() {
    try { if (fs.existsSync(portFilePath)) fs.unlinkSync(portFilePath); } catch (_e) { /* swallow */ }
    delete process.env.MOBILE_AUTOMATOR_RECORDER_C3_PORT;
  }

  async function closeListener() {
    try { await listener.close(); } catch (_e) { /* swallow */ }
  }

  function finish(code) {
    if (resolved) return;
    resolved = true;
    if (timeoutHandle) {
      _clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    cleanupDiscovery();
    closeListener().then(() => resolveExit(code), () => resolveExit(code));
  }

  // ---- Event wiring --------------------------------------------------------

  listener.emitter.on('handshake', () => {
    handshaken = true;
    if (timeoutHandle) {
      _clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    wsCtx.broadcast({ type: 'c3-handshake', session_id: sessionId });
  });

  // C3 events are pre-coalesced by the in-app SDK — no classifier / type
  // buffer needed. We forward straight to the store.
  listener.emitter.on('event', (msg) => {
    try {
      store.appendEvent(msg);
    } catch (_e) { /* swallow — appendEvent is best-effort */ }
  });

  // ---- WS handlers ---------------------------------------------------------

  wsCtx.onMessage(async (msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'c3-fallback-choice') {
      if (msg.choice === 'use_mode_b') {
        // Tear down the C3 listener + discovery, then hand off to Mode B.
        if (timeoutHandle) {
          _clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        cleanupDiscovery();
        await closeListener();
        try {
          const code = await _startModeB({
            store, wsCtx, httpSrv, projectRoot, scenarioId: sessionId,
            platform, appPackage, opts, deps,
          });
          if (!resolved) { resolved = true; resolveExit(code); }
        } catch (e) {
          if (!resolved) { resolved = true; resolveExit(1); }
        }
        return;
      }
      if (msg.choice === 'cancel') {
        wsCtx.broadcast({ type: 'recording-cancelled' });
        try { store.cleanupOnCancel(); } catch (_e) { /* swallow */ }
        finish(130);
        return;
      }
    }
    if (msg.type === 'cancel') {
      wsCtx.broadcast({ type: 'recording-cancelled' });
      try { store.cleanupOnCancel(); } catch (_e) { /* swallow */ }
      finish(130);
      return;
    }
    if (msg.type === 'save') {
      // Save while C3 connected — preserve the bundle and exit cleanly.
      finish(0);
    }
  });

  // ---- Handshake-timeout timer --------------------------------------------

  let timeoutHandle = _setTimeout(() => {
    timeoutHandle = null;
    if (handshaken || resolved) return;
    wsCtx.broadcast({ type: 'c3-fallback-prompt', reason: 'sdk_timeout' });
  }, handshakeTimeoutMs);

  return exitPromise;
}

module.exports = { startC3, DEFAULT_HANDSHAKE_TIMEOUT_MS };
