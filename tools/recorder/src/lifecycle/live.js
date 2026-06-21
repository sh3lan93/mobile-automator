'use strict';

const { ArtifactsStore } = require('../artifacts');
const { startHttpServer } = require('../server/http-server');
const { attachWsServer } = require('../server/ws-protocol');
const { openInBrowser } = require('../server/browser-opener');
const { loadProjectConfig, resolveModeAndDefaults } = require('../config');

/**
 * Top-level live-capture orchestrator.
 *
 * Initialises the artifact bundle, brings up the HTTP + WebSocket sidecar that
 * the GUI talks to, then branches on `mode` to either the C3 in-app SDK path
 * or the Mode B device-driven path. Returns a Promise that resolves with the
 * process exit code once the underlying lifecycle handler signals completion.
 *
 * `deps` is the seam for tests: it lets the suite inject fake `startC3`,
 * `startModeB`, and `ArtifactsStore` so the orchestrator can be exercised
 * without a real device or TCP listener.
 */
async function startLiveCapture({
  projectRoot,
  scenarioId,
  platform,
  mode,
  opts = {},
  deps = {},
} = {}) {
  const StoreCtor = deps.ArtifactsStore || ArtifactsStore;
  const _startHttp = deps.startHttpServer || startHttpServer;
  const _attachWs = deps.attachWsServer || attachWsServer;
  const _startC3 = deps.startC3 || require('./c3').startC3;
  const _startModeB = deps.startModeB || require('./mode-b').startModeB;
  const _openBrowser = deps.openInBrowser || openInBrowser;

  // Project config drives aware-vs-agnostic emit downstream. Pre-#29 configs
  // are coerced to platform-aware by resolveModeAndDefaults.
  const cfg = resolveModeAndDefaults(loadProjectConfig(projectRoot));
  const emitMode = cfg.mode;
  const appPackage = cfg.app_package || cfg.appPackage || null;

  const store = new StoreCtor({ projectRoot, scenarioId });
  store.init({
    mode: emitMode,
    scenario_id: scenarioId,
    platform,
    capture_mode: mode,
    started_at: new Date().toISOString(),
  });

  const httpSrv = await _startHttp({
    projectRoot,
    scenarioId,
    mode: emitMode,
    allowSensitiveInput: !!opts.allowSensitiveInput,
  });
  const wsCtx = _attachWs({ httpServer: httpSrv.server });

  // Print the recorder GUI URL and auto-launch the default browser (#65).
  // The URL is written to STDERR (never stdout) so the verb's JSON envelope on
  // stdout stays clean; it is logged unconditionally so the user always has a
  // fallback if auto-open fails silently (unsupported platform, ENOENT) or if
  // the tab is closed mid-recording. `--no-gui` (opts.noGui) skips the launch
  // so CI / headless / test mode stays browser-free.
  const guiUrl = `http://127.0.0.1:${httpSrv.port}/`;
  console.error(`🌐 Recorder GUI: ${guiUrl}`);
  _openBrowser({ url: guiUrl, noGui: !!opts.noGui });

  // Broadcast the initial mode message so any client that connects sees the
  // emit mode without an extra round-trip.
  wsCtx.broadcast({ type: 'mode', mode: emitMode });

  // Slice 8: the live path drives a real device by default. Tests that inject a
  // fake startModeB/startC3 never reach the device wiring; tests that exercise
  // the real handler can still opt out by setting deps.useLiveDevice === false.
  const handlerDeps = deps.useLiveDevice === undefined
    ? { ...deps, useLiveDevice: true }
    : deps;

  const handlerArgs = {
    store,
    wsCtx,
    httpSrv,
    projectRoot,
    scenarioId,
    platform,
    appPackage,
    opts,
    deps: handlerDeps,
  };

  let exitCode;
  try {
    if (mode === 'c3') {
      exitCode = await _startC3({ ...handlerArgs, sessionId: scenarioId });
    } else {
      exitCode = await _startModeB(handlerArgs);
    }
  } finally {
    try { wsCtx.close(); } catch (_e) { /* swallow */ }
    try { await httpSrv.close(); } catch (_e) { /* swallow */ }
  }

  return exitCode;
}

module.exports = { startLiveCapture };
