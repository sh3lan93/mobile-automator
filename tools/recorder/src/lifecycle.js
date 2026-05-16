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
const { GeteventStreamParser } = require('./capture/adb-getevent');
const { loadProjectConfig, resolveModeAndDefaults } = require('./config');

function snakeCase(s) {
  return String(s || '')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'field';
}

async function runScriptedSession({ projectRoot, scenarioId, script }) {
  const cfg = resolveModeAndDefaults(loadProjectConfig(projectRoot));
  const mode = cfg.mode;
  const store = new ArtifactsStore({ projectRoot, scenarioId });
  store.init({ mode, scenario_id: scenarioId });

  for (const snap of script.hierarchy_snapshots) {
    store.writeHierarchySnapshot(snap.t, snap);
  }

  // Use a stub bridge with no-op responses; we don't poll in scripted mode.
  const poller = new HierarchyPoller({ bridge: { listElementsOnScreen: async () => ({ elements: [] }) }, intervalMs: 9999, capacity: 50 });
  for (const snap of script.hierarchy_snapshots) poller._appendForTest(snap);

  // Each capture source pushes here; we sort by `t` and append once at the
  // end so events.jsonl is chronologically merged across sources (gestures,
  // type buffer, adb-getevent hardware keys). Live capture will graduate this
  // offline sort to a streaming priority queue, but the event shape stays
  // identical.
  const pending = [];

  const typeBuffer = new TypeBuffer({
    emit: (e) => {
      const stepId = `type_${snakeCase(e.field_label || e.field_id)}`.slice(0, 60);
      pending.push({ ...e, step_id: stepId });
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
      pending.push({ ...g, target: resolved?.display_name, step_id: stepId });
    },
  });

  for (const ev of script.tap_events) classifier.feed(ev);
  classifier.flush();
  typeBuffer.flush();

  // Hardware-key supplement (Android only). Aware-mode emits one
  // `press_button` step per key release — DOWN events are absorbed and only
  // the UP edge produces a user-visible step, mirroring Espresso's
  // `pressBack()` semantics where one press == one action.
  if (Array.isArray(script.key_events) && script.key_events.length > 0) {
    const keyParser = new GeteventStreamParser({
      emit: (k) => {
        if (k.state !== 'up') return;
        pending.push({
          kind: 'press_button',
          t: k.t,
          value: k.key,
          step_id: `press_button_${k.key.toLowerCase()}`.slice(0, 60),
        });
      },
      tStart: 0,
    });
    for (const ke of script.key_events) {
      const stateLabel = String(ke.state || '').toUpperCase();
      // Synthesise the same line shape `parseGeteventLine` expects so the
      // scripted-session driver and a live `adb` stdout stream go through
      // exactly one parser.
      const line = `[   ${ke.t_seconds.toFixed(6)}] /dev/input/event0: EV_KEY       KEY_${ke.key}             ${stateLabel}\n`;
      keyParser.feedChunk(line);
    }
    keyParser.end();
  }

  pending.sort((a, b) => a.t - b.t);
  for (const ev of pending) store.appendEvent(ev);
}

module.exports = { runScriptedSession };
