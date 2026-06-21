'use strict';

const { McpBridge } = require('../capture/mobile-mcp-bridge');
const { HierarchyPoller } = require('../capture/hierarchy-poller');
const { GestureClassifier } = require('../coalesce/gesture-classifier');
const { TypeBuffer } = require('../coalesce/type-buffer');
const { reinterpret } = require('../coalesce/semantic-reinterpreter');
const { toStepView } = require('../coalesce/step-view');
const { resolveElement } = require('../capture/element-resolver');
const { findFocusedField } = require('../capture/focus-detector');
const { isInKeyboardRegion, keyAtCoordinate } = require('../capture/keyboard-region');
const { loadProjectConfig, resolveModeAndDefaults } = require('../config');
const { attachFailureModes } = require('../failure/orchestrator');
const {
  handleSaveMessage,
  handleCancelMessage,
  handleRequestAssertionScreenshot,
  handleSaveAssertion,
  handleCancelAssertion,
  handleRenameStep,
  handleEditValue,
  handleEditAssertionText,
  handleDeleteStep,
  handleMarkAsSemantic,
} = require('../session-handlers');

const DEFAULT_POLL_INTERVAL_MS = 500;

function snakeCase(s) {
  return String(s || '')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'field';
}

/**
 * Mode B lifecycle orchestrator.
 *
 * Wires the deep capture modules (mobile-mcp bridge, hierarchy poller,
 * gesture classifier, type buffer, semantic reinterpreter) into the live
 * pipeline, attaches the failure orchestrator (slice #29), and registers the
 * WS message handlers from session-handlers.js. Returns a Promise that
 * resolves with the exit code (0 on Save, 130 on Cancel or browser timeout,
 * 2 on device disconnect, etc.).
 *
 * Slice 8 — the live tap source is now wired by default in the live path
 * (`deps.useLiveDevice`): `capture/tap-source.js` drives mobile-mcp screen
 * recording through `capture/video-tap-detector.js` and emits
 * `{t, kind:'down'|'up'|'move', x, y}` taps. That end-to-end live path is
 * BEST-EFFORT and needs on-device validation (the known PRD build risk — see
 * tap-source.js). Tests still inject `deps.tapSource` to drive the pipeline
 * deterministically without a device; a missing tap source in non-live mode is
 * fine — it just means no live taps are captured.
 *
 * `deps` is the seam for tests:
 *   • mcpBridge — pre-constructed bridge (skip the default ctor)
 *   • tapSource — EventEmitter-like with `.on('tap', cb)` for live taps
 *   • pollIntervalMs — override the 500ms default
 *   • hierarchyPoller — pre-constructed poller (skip the default ctor)
 *   • attachFailureModes — fake the failure orchestrator
 */
async function startModeB({
  store,
  wsCtx,
  httpSrv, // eslint-disable-line no-unused-vars
  projectRoot,
  scenarioId,
  platform,
  appPackage,
  opts = {}, // eslint-disable-line no-unused-vars
  deps = {},
} = {}) {
  // ---- Config / mode -------------------------------------------------------

  const cfg = resolveModeAndDefaults(loadProjectConfig(projectRoot));
  const emitMode = cfg.mode;

  // ---- Bridge + poller -----------------------------------------------------
  //
  // Slice 8: the live device `call` is backed by the CLI-owned mobile-mcp
  // connection (capture/recorder-device-io → src/device/mobile-mcp-client).
  // Tests keep injecting fakes via `deps.mcpBridge` or `deps.mcpCall`, which
  // short-circuit the live wiring so nothing spawns. When neither is provided
  // and a `deps.deviceLabel` is available, the live path opens a real
  // connection (kept injectable through `deps.createRecorderCall`).
  let deviceConn = null;
  let mcpCall = deps.mcpCall;
  if (!deps.mcpBridge && !mcpCall && deps.useLiveDevice) {
    const { createRecorderCall } = require('../capture/recorder-device-io');
    const _createRecorderCall = deps.createRecorderCall || createRecorderCall;
    deviceConn = await _createRecorderCall({ device: deps.deviceLabel });
    mcpCall = deviceConn.call;
  }

  const mcpBridge = deps.mcpBridge || new McpBridge({
    call: mcpCall || (async () => ({ elements: [] })),
  });

  const pollIntervalMs = deps.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS;
  const hierarchyPoller = deps.hierarchyPoller || new HierarchyPoller({
    bridge: mcpBridge,
    intervalMs: pollIntervalMs,
    capacity: 40,
    onSuccess: () => {
      // Each successful poll feeds the most recent snapshot to disk so the
      // generator can reconstruct UI context at any timestamp.
      const buffer = hierarchyPoller._buffer; // private but stable
      if (buffer && buffer.length > 0) {
        const latest = buffer[buffer.length - 1];
        try { store.writeHierarchySnapshot(latest.t, latest); } catch (_e) { /* swallow */ }
      }
    },
  });

  // ---- Coalescing pipeline -------------------------------------------------
  // Mirrors `runScriptedSession` in lifecycle.js, but driven by live sources.

  // Persist a captured step AND broadcast it so the GUI renders it live
  // (defect B fix — #103). The store write is the source of truth; we only
  // broadcast on a successful append. The index is a 1-based running counter
  // matching the order steps land in events.jsonl.
  let stepIndex = 0;
  const recordStep = (ev) => {
    try { store.appendEvent(ev); } catch (_e) { return; }
    try { wsCtx.broadcast({ type: 'step-added', step: toStepView(ev, ++stepIndex) }); } catch (_e) { /* swallow */ }
  };

  const typeBuffer = new TypeBuffer({
    emit: (e) => {
      const stepId = `type_${snakeCase(e.field_label || e.field_id)}`.slice(0, 60);
      recordStep(reinterpret({ ...e, step_id: stepId }, null, emitMode));
    },
    silenceTimeoutMs: 1500,
  });

  const classifier = new GestureClassifier({
    emit: (g) => {
      const snap = hierarchyPoller.findSnapshotBefore(g.t);
      // Route keyboard-region taps to TypeBuffer rather than emitting them.
      if (g.kind === 'tap' && snap && isInKeyboardRegion(snap, g.x, g.y)) {
        const focused = findFocusedField(snap);
        if (focused) typeBuffer.observeFocus({ t: g.t, field: focused });
        const key = keyAtCoordinate(snap, g.x, g.y);
        if (key !== null) typeBuffer.observeKeyboardTap({ t: g.t, key });
        return;
      }
      const resolved = snap ? resolveElement(snap, g.x || g.from?.[0], g.y || g.from?.[1]) : null;
      const stepId = resolved
        ? `${g.kind}_${resolved.display_name.replace(/\s+/g, '_').toLowerCase()}`.slice(0, 60)
        : `${g.kind}_unknown`;
      recordStep(reinterpret({ ...g, target: resolved?.display_name, step_id: stepId }, snap, emitMode));
    },
  });

  // ---- Live tap source -----------------------------------------------------
  // Tests inject `deps.tapSource` to drive the pipeline. The live path (slice 8)
  // defaults to capture/tap-source, which plugs mobile-mcp screen recording into
  // video-tap-detector to produce {t, kind, x, y} taps. This end-to-end live
  // path is BEST-EFFORT and needs on-device validation (see tap-source.js).
  let tapSource = deps.tapSource;
  let ownsTapSource = false;
  if (!tapSource && deps.useLiveDevice) {
    if (platform === 'android') {
      const { createGeteventTapSource } = require('../capture/getevent-tap-source');
      const _create = deps.createGeteventTapSource || createGeteventTapSource;
      tapSource = _create({ deviceLabel: deps.deviceLabel });
    } else {
      const { createScreenshotTapSource } = require('../capture/screenshot-tap-source');
      const _create = deps.createScreenshotTapSource || createScreenshotTapSource;
      tapSource = _create({ deviceLabel: deps.deviceLabel });
    }
    ownsTapSource = true;
  }
  if (tapSource && typeof tapSource.on === 'function') {
    tapSource.on('tap', (ev) => {
      try { classifier.feed(ev); } catch (_e) { /* swallow */ }
    });
  }

  // ---- Failure orchestrator ------------------------------------------------

  let resolveExit;
  const exitPromise = new Promise((res) => { resolveExit = res; });
  let resolved = false;
  function finish(code) {
    if (resolved) return;
    resolved = true;
    try { hierarchyPoller.stop(); } catch (_e) { /* swallow */ }
    try { classifier.flush(); } catch (_e) { /* swallow */ }
    try { typeBuffer.flush(); } catch (_e) { /* swallow */ }
    // Tear down failure-orchestrator watchdogs (crash + browser timers).
    if (failureCtx && typeof failureCtx.stopAll === 'function') {
      try { failureCtx.stopAll(); } catch (_e) { /* swallow */ }
    }
    // Stop a tap source we own (the live one). Best-effort + async; we don't
    // await it here since finish() is sync, but errors must not leak.
    if (ownsTapSource && tapSource && typeof tapSource.stop === 'function') {
      try { Promise.resolve(tapSource.stop()).catch(() => {}); } catch (_e) { /* swallow */ }
    }
    // Close the live device connection (no-op when tests injected a fake).
    if (deviceConn && typeof deviceConn.close === 'function') {
      try { deviceConn.close(); } catch (_e) { /* swallow */ }
    }
    resolveExit(code);
  }

  const _attachFailureModes = deps.attachFailureModes || attachFailureModes;
  const failureCtx = _attachFailureModes({
    store,
    wsCtx,
    mcpBridge,
    hierarchyPoller,
    projectRoot,
    scenarioId,
    deviceLabel: deps.deviceLabel || 'device',
    appPackage,
    onDone: (code) => finish(code),
    deviceWatchdogOpts: deps.deviceWatchdogOpts,
    crashWatchdogOpts: deps.crashWatchdogOpts,
    browserWatchdogOpts: deps.browserWatchdogOpts,
  });

  // ---- WS message dispatch -------------------------------------------------
  // Mirrors the standard session-handlers wiring. The crash-choice + browser
  // disconnect handlers are owned by attachFailureModes; everything else
  // (save / cancel / assertion / edit) lives here.

  let assertionCounter = 0;
  const allocateId = () => `a${++assertionCounter}`;
  const broadcast = (m) => wsCtx.broadcast(m);

  wsCtx.onMessage((msg) => {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'save':
        handleSaveMessage({ store, onDone: (code) => finish(code) });
        break;
      case 'cancel':
        handleCancelMessage({ store, onDone: (code) => finish(code) });
        break;
      case 'request-assertion-screenshot':
        handleRequestAssertionScreenshot({ store, mcp: mcpBridge, broadcast, allocateId });
        break;
      case 'save-assertion':
        handleSaveAssertion({ store, broadcast, msg });
        break;
      case 'cancel-assertion':
        handleCancelAssertion({ store, msg });
        break;
      case 'rename-step':
        handleRenameStep({ store, broadcast, msg });
        break;
      case 'edit-value':
        handleEditValue({ store, broadcast, msg });
        break;
      case 'edit-assertion-text':
        handleEditAssertionText({ store, broadcast, msg });
        break;
      case 'delete-step':
        handleDeleteStep({ store, broadcast, msg });
        break;
      case 'mark-as-semantic':
        handleMarkAsSemantic({ store, broadcast, msg });
        break;
      default:
        // Unknown message — ignore. Other branches (e.g. crash-choice) are
        // claimed by attachFailureModes via its own onMessage subscription.
        break;
    }
  });

  // ---- Start the poller (and live tap source) and yield -------------------

  try { hierarchyPoller.start(); } catch (_e) { /* swallow */ }
  // Start a tap source we own. Best-effort: a device/recording failure here is
  // swallowed so the rest of the session (hierarchy, assertions) still runs.
  if (ownsTapSource && tapSource && typeof tapSource.start === 'function') {
    try { Promise.resolve(tapSource.start()).catch(() => {}); } catch (_e) { /* swallow */ }
  }

  return exitPromise;
}

module.exports = { startModeB, DEFAULT_POLL_INTERVAL_MS };
