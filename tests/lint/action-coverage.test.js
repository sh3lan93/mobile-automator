'use strict';

// Structural guard: the scenario schema's action vocabulary, the action
// catalog, the `mauto` verb surface, and the execute guide must agree. This is
// the mechanical contract that stops them from drifting again (see #116/#117):
// an action that loses a faithful execution path fails HERE instead of
// silently degrading to the wrong gesture at replay time.

const fs = require('fs');
const path = require('path');

const { ACTION_CATALOG, RESOLUTIONS } = require('../../src/device/action-catalog');
const { DeviceBridge } = require('../../src/device/bridge');
const { ACTION_METHOD } = require('../../src/device/semantic-press');
const { buildProgram } = require('../../src/cli');

const REPO = path.join(__dirname, '..', '..');
const schema = require('../../src/schemas/scenario_schema.json');
const bridgeSource = fs.readFileSync(path.join(REPO, 'src', 'device', 'bridge.js'), 'utf8');
const guideAware = fs.readFileSync(path.join(REPO, 'src', 'guide', 'content', 'execute.aware.md'), 'utf8');
const guideAgnostic = fs.readFileSync(path.join(REPO, 'src', 'guide', 'content', 'execute.agnostic.md'), 'utf8');

// Both places the schema enumerates actions.
const stepActions = schema.definitions.step.properties.action.enum;
const deviceActions =
  schema.properties.preconditions.properties.device_actions.items.properties.action.enum;
const schemaActions = new Set([...stepActions, ...deviceActions]);

// Top-level command names registered on the program.
const verbNames = new Set(buildProgram().commands.map((c) => c.name()));

const entries = (resolution) =>
  Object.keys(ACTION_CATALOG).filter((a) => ACTION_CATALOG[a].resolution === resolution);

describe('action coverage — schema ↔ catalog ↔ verbs ↔ guide', () => {
  test('every catalog entry declares a known resolution', () => {
    for (const [action, def] of Object.entries(ACTION_CATALOG)) {
      expect(RESOLUTIONS).toContain(def.resolution);
      expect(typeof action).toBe('string');
    }
  });

  test('catalog covers exactly the schema action vocabulary (no orphans either way)', () => {
    const catalogActions = new Set(Object.keys(ACTION_CATALOG));
    const missingFromCatalog = [...schemaActions].filter((a) => !catalogActions.has(a));
    const missingFromSchema = [...catalogActions].filter((a) => !schemaActions.has(a));
    expect(missingFromCatalog).toEqual([]); // schema action with no execution contract
    expect(missingFromSchema).toEqual([]); // catalog entry the schema never declares
  });

  describe("resolution: 'verb' — backed by a real bridge method + primitive + CLI verb", () => {
    test.each(entries('verb'))('%s has a faithful execution path', (action) => {
      const def = ACTION_CATALOG[action];
      // The DeviceBridge method exists...
      expect(typeof DeviceBridge.prototype[def.bridge]).toBe('function');
      // ...and bridge.js actually wires it to the declared mobile-mcp primitive
      // (catches a method that calls the wrong/no primitive).
      expect(bridgeSource).toContain(def.primitive);
      // ...and a `mauto` verb is registered to drive it.
      expect(verbNames).toContain(def.verb);
    });
  });

  describe("resolution: 'semantic' — resolved via `mauto press`", () => {
    test.each(entries('semantic'))('%s is a known semantic action', (action) => {
      expect(Object.prototype.hasOwnProperty.call(ACTION_METHOD, action)).toBe(true);
      expect(verbNames).toContain('press');
    });
  });

  describe("resolution: 'unsupported' — no verb, never promised by the guide", () => {
    const unsupported = entries('unsupported');

    test.each(unsupported)('%s has no CLI verb named after it', (action) => {
      expect(verbNames.has(action)).toBe(false);
    });

    test.each(unsupported)('%s is never mapped to a `mauto` verb in the execute guide', (action) => {
      for (const guide of [guideAware, guideAgnostic]) {
        const offending = guide
          .split('\n')
          .filter((line) => line.includes(action) && /`mauto\s+[a-z-]+/.test(line));
        expect(offending).toEqual([]);
      }
    });
  });
});
