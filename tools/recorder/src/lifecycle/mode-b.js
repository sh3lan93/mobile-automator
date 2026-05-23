'use strict';

const { McpBridge } = require('../capture/mobile-mcp-bridge');
const { HierarchyPoller } = require('../capture/hierarchy-poller');
const { GestureClassifier } = require('../coalesce/gesture-classifier');
const { TypeBuffer } = require('../coalesce/type-buffer');
const { reinterpret } = require('../coalesce/semantic-reinterpreter');
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
 * NOTE — live tap source is a TODO. The first "live" run won't actually
 * capture taps until the tap source is implemented properly: mobile-mcp's
 * frame-streaming surface is the natural source (combined with the existing
 * `capture/video-tap-detector.js` module) but the deep integration is out of
 * scope for this slice. Tests inject taps via `deps.tapSource` (an emitter
 * that fires `{t, kind:'down'|'up'|'move', x, y}` events) so the rest of the
 * pipeline can be exercised end-to-end.
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
  platform, // eslint-disable-line no-unused-vars
  appPackage,
  opts = {}, // eslint-disable-line no-unused-vars
  deps = {},
} = {}) {
  // ---- Config / mode -------------------------------------------------------

  const cfg = resolveModeAndDefaults(loadProjectConfig(projectRoot));
  const emitMode = cfg.mode;

  // ---- Bridge + poller -----------------------------------------------------

  const mcpBridge = deps.mcpBridge || new McpBridge({
    call: deps.mcpCall || (async () => ({ elements: [] })),
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

  const typeBuffer = new TypeBuffer({
    emit: (e) => {
      const stepId = `type_${snakeCase(e.field_label || e.field_id)}`.slice(0, 60);
      try {
        store.appendEvent(reinterpret({ ...e, step_id: stepId }, null, emitMode));
      } catch (_e) { /* swallow */ }
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
      try {
        store.appendEvent(reinterpret({ ...g, target: resolved?.display_name, step_id: stepId }, snap, emitMode));
      } catch (_e) { /* swallow */ }
    },
  });

  // ---- Live tap source (TODO) ---------------------------------------------
  // See the file-level doc comment: the real tap source plugs into mobile-mcp
  // frame streaming + capture/video-tap-detector. For now we honour the
  // injected `deps.tapSource` so tests can drive the pipeline, but a missing
  // tapSource is fine — it just means no live taps are captured this slice.
  if (deps.tapSource && typeof deps.tapSource.on === 'function') {
    deps.tapSource.on('tap', (ev) => {
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

  // ---- Start the poller and yield -----------------------------------------

  try { hierarchyPoller.start(); } catch (_e) { /* swallow */ }

  return exitPromise;
}

module.exports = { startModeB, DEFAULT_POLL_INTERVAL_MS };
