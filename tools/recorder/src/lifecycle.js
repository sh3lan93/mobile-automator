'use strict';

const path = require('path');
const { McpBridge } = require('./capture/mobile-mcp-bridge');
const { HierarchyPoller } = require('./capture/hierarchy-poller');
const { GestureClassifier } = require('./coalesce/gesture-classifier');
const { ArtifactsStore } = require('./artifacts');
const { resolveElement } = require('./capture/element-resolver');
const { findFocusedField } = require('./capture/focus-detector');
const { isInKeyboardRegion, keyAtCoordinate } = require('./capture/keyboard-region');
const { TypeBuffer } = require('./coalesce/type-buffer');

function snakeCase(s) {
  return String(s || '')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'field';
}

async function runScriptedSession({ projectRoot, scenarioId, script }) {
  const store = new ArtifactsStore({ projectRoot, scenarioId });
  store.init({ mode: 'platform-aware', scenario_id: scenarioId });

  for (const snap of script.hierarchy_snapshots) {
    store.writeHierarchySnapshot(snap.t, snap);
  }

  // Use a stub bridge with no-op responses; we don't poll in scripted mode.
  const poller = new HierarchyPoller({ bridge: { listElementsOnScreen: async () => ({ elements: [] }) }, intervalMs: 9999, capacity: 50 });
  for (const snap of script.hierarchy_snapshots) poller._appendForTest(snap);

  const typeBuffer = new TypeBuffer({
    emit: (e) => {
      const stepId = `type_${snakeCase(e.field_label || e.field_id)}`.slice(0, 60);
      store.appendEvent({ ...e, step_id: stepId });
    },
    silenceTimeoutMs: 9999,
  });

  const classifier = new GestureClassifier({
    emit: (g) => {
      const snap = poller.findSnapshotBefore(g.t);
      // Route taps that landed in the keyboard region to TypeBuffer.
      if (g.kind === 'tap' && snap && isInKeyboardRegion(snap, g.x, g.y)) {
        const focused = findFocusedField(snap);
        if (focused) {
          typeBuffer.observeFocus({ t: g.t, field: focused });
        }
        const key = keyAtCoordinate(snap, g.x, g.y);
        if (key !== null) {
          typeBuffer.observeKeyboardTap({ t: g.t, key });
        }
        return;
      }
      const resolved = snap ? resolveElement(snap, g.x || g.from?.[0], g.y || g.from?.[1]) : null;
      const stepId = resolved ? `${g.kind}_${resolved.display_name.replace(/\s+/g, '_').toLowerCase()}`.slice(0, 60) : `${g.kind}_unknown`;
      store.appendEvent({ ...g, target: resolved?.display_name, step_id: stepId });
    },
  });

  for (const ev of script.tap_events) classifier.feed(ev);
  classifier.flush();
  typeBuffer.flush();
}

module.exports = { runScriptedSession };
