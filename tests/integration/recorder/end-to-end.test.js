'use strict';

// End-to-end integration test for the #22 tracer-bullet recorder slice.
//
// Drives the recorder pipeline end-to-end at the contract level:
//
//   1. `runScriptedSession` (the real lifecycle entry point from Task 1.11)
//      consumes a scripted-session fixture and produces an artifact bundle
//      under `mobile-automator/.recorder/<scenario_id>/`.
//   2. A test-fixture deterministic synthesizer ("mock AI") reads the
//      bundle's `events.jsonl` and writes a v2.1 scenario JSON, mirroring
//      the contract that the real recorder skill template fulfils. It also
//      promotes the bundle's screenshots/ directory to the public location.
//   3. `handleSaveMessage` (Task 2.6) is invoked with an injected `onDone`
//      callback to capture the signalled exit code without `process.exit`.
//
// Slice 8 (recorder decoupling, #77): a SUCCESSFUL Save now PERSISTS the
// artifact bundle under `mobile-automator/.recorder/<id>/` — recording is a
// standalone step and synthesis (which reads + consumes the bundle) is
// decoupled. The synthesizer below therefore no longer deletes the bundle, and
// invariant C asserts the bundle PERSISTS after Save (cleanup is the separate
// `consume` step exercised by the bundle-reader tests). CANCEL still removes.
//
// The test then pins these invariants from the issue's acceptance criteria:
//
//   A. `mobile-automator/scenarios/<id>.json` exists and validates against
//      the v2.1 scenario schema.
//   B. `mobile-automator/screenshots/<id>/` exists.
//   C. `mobile-automator/.recorder/<id>/` PERSISTS after the Save flow, and a
//      subsequent Cancel removes it.
//
// Per #22 scope: tap-only flow, no real AI, no real browser. This test does
// NOT validate the real AI's behaviour — that contract is covered by the
// structural test in `ai-skill-ingestion.test.js`. The synthesize helper
// here is a test-only stand-in that fixes the contract: the bundle the
// lifecycle produces is, by shape, sufficient for an AI-shaped consumer to
// produce a schema-valid scenario JSON.

const fs = require('fs');
const path = require('path');
const os = require('os');

const { runScriptedSession } = require('../../../tools/recorder/src/lifecycle');
const { ArtifactsStore } = require('../../../tools/recorder/src/artifacts');
const { handleSaveMessage, handleCancelMessage } = require('../../../tools/recorder/src/session-handlers');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCENARIO_SCHEMA_PATH = path.join(
  REPO_ROOT,
  'src',
  'schemas',
  'scenario_schema.json'
);
const SCRIPTED_SESSION_FIXTURE_PATH = path.join(
  REPO_ROOT,
  'tests',
  'fixtures',
  'recorder',
  'scripted-session.json'
);

// --- Inline JSON-schema validator -------------------------------------------
//
// Matches the validator used in `ai-skill-ingestion.test.js`. It covers the
// invariants the v2.1 scenario schema relies on: required-fields, enums,
// regex patterns, type tags, item recursion, and local $ref resolution. This
// is intentionally narrow — it is not a general JSON-Schema engine. Kept
// inline here to avoid a one-consumer refactor; the duplication is small.

function resolveRef(rootSchema, ref) {
  const parts = ref.replace(/^#\//, '').split('/');
  let node = rootSchema;
  for (const p of parts) node = node[p];
  return node;
}

function jsTypeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function typeMatches(typeSpec, value) {
  const actual = jsTypeOf(value);
  const allowed = Array.isArray(typeSpec) ? typeSpec : [typeSpec];
  if (allowed.includes(actual)) return true;
  if (allowed.includes('number') && actual === 'integer') return true;
  return false;
}

function validate(rootSchema, schema, value, pathStr, errors) {
  if (schema.$ref) schema = resolveRef(rootSchema, schema.$ref);

  if (schema.type && !typeMatches(schema.type, value)) {
    errors.push(`${pathStr}: expected type ${JSON.stringify(schema.type)}, got ${jsTypeOf(value)}`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${pathStr}: value ${JSON.stringify(value)} not in enum ${JSON.stringify(schema.enum)}`);
  }
  if (schema.pattern && typeof value === 'string') {
    const re = new RegExp(schema.pattern);
    if (!re.test(value)) errors.push(`${pathStr}: value ${JSON.stringify(value)} does not match pattern ${schema.pattern}`);
  }
  if (schema.maxLength != null && typeof value === 'string' && value.length > schema.maxLength) {
    errors.push(`${pathStr}: string longer than maxLength ${schema.maxLength}`);
  }

  if (
    schema.type === 'object' ||
    (Array.isArray(schema.type) && schema.type.includes('object')) ||
    (!schema.type && (schema.required || schema.properties))
  ) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (Array.isArray(schema.required)) {
        for (const k of schema.required) {
          if (!(k in value)) errors.push(`${pathStr}: missing required field "${k}"`);
        }
      }
      if (schema.properties) {
        for (const [k, sub] of Object.entries(schema.properties)) {
          if (k in value) validate(rootSchema, sub, value[k], `${pathStr}.${k}`, errors);
        }
      }
    }
  }

  if (schema.type === 'array' && Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) {
      errors.push(`${pathStr}: fewer than minItems ${schema.minItems}`);
    }
    if (schema.maxItems != null && value.length > schema.maxItems) {
      errors.push(`${pathStr}: more than maxItems ${schema.maxItems}`);
    }
    if (schema.items) {
      value.forEach((item, i) => validate(rootSchema, schema.items, item, `${pathStr}[${i}]`, errors));
    }
  }
}

function validateScenarioAgainstSchema(scenario, schema) {
  const errors = [];
  validate(schema, schema, scenario, '$', errors);
  return errors;
}

// --- Test-fixture deterministic synthesizer ("mock AI") --------------------
//
// Mirrors the recorder skill's contract: read the artifact bundle, emit a
// v2.1 scenario JSON, and move screenshots to the public location. Lives here
// (not in production code) on purpose — the real synthesis is the AI's job;
// this stand-in exists only to pin the shape-of-the-bundle contract. Post
// slice 8 it does NOT delete the bundle: Save persists it, and consuming the
// bundle is a separate decoupled step (covered by the bundle-reader tests).

function synthesizeScenario(projectRoot, scenarioId) {
  const bundleRoot = path.join(projectRoot, 'mobile-automator', '.recorder', scenarioId);
  const eventsRaw = fs.readFileSync(path.join(bundleRoot, 'events.jsonl'), 'utf8');
  const SUPPORTED_KINDS = new Set(['tap', 'long_press', 'double_tap', 'swipe']);
  const events = eventsRaw
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l))
    .filter((e) => SUPPORTED_KINDS.has(e.kind));

  const steps = events.map((ev, i) => {
    const target = ev.target || 'element';
    if (ev.kind === 'long_press') {
      return {
        id: ev.step_id || `long_press_step_${i + 1}`,
        action: 'long_press',
        description: `Long press ${target}.`,
        target,
      };
    }
    if (ev.kind === 'double_tap') {
      return {
        id: ev.step_id || `double_tap_step_${i + 1}`,
        action: 'double_tap',
        description: `Double tap ${target}.`,
        target,
      };
    }
    if (ev.kind === 'swipe') {
      const direction = ev.direction || 'up';
      return {
        id: ev.step_id || `swipe_step_${i + 1}`,
        action: 'swipe',
        description: `Swipe ${direction}.`,
        target,
        value: direction,
      };
    }
    // Default: tap.
    return {
      id: ev.step_id || `tap_step_${i + 1}`,
      action: 'tap',
      description: `Tap ${target}.`,
      target,
    };
  });

  const scenario = {
    $schema_version: '2.1',
    scenario_id: scenarioId,
    name: 'End-to-end synthesized scenario',
    description: 'Tap-only scenario synthesized by the test-fixture mock AI.',
    platform: 'android',
    app_package: 'com.example.app',
    metadata: { app_version: '1.0.0', environment: 'staging' },
    tags: ['smoke'],
    steps,
    assertions: [],
  };

  // Promote screenshots/ from the bundle to the public location.
  const publicScreenshotsDir = path.join(projectRoot, 'mobile-automator', 'screenshots', scenarioId);
  fs.mkdirSync(publicScreenshotsDir, { recursive: true });
  const bundleScreenshotsDir = path.join(bundleRoot, 'screenshots');
  if (fs.existsSync(bundleScreenshotsDir)) {
    for (const f of fs.readdirSync(bundleScreenshotsDir)) {
      fs.copyFileSync(path.join(bundleScreenshotsDir, f), path.join(publicScreenshotsDir, f));
    }
  }

  // Write scenario JSON.
  const scenariosDir = path.join(projectRoot, 'mobile-automator', 'scenarios');
  fs.mkdirSync(scenariosDir, { recursive: true });
  const scenarioPath = path.join(scenariosDir, `${scenarioId}.json`);
  fs.writeFileSync(scenarioPath, JSON.stringify(scenario, null, 2));

  // Slice 8: the bundle PERSISTS on Save — no cleanupOnSuccess here. The
  // store is returned so the Save handler can run and the test can later
  // exercise the explicit Cancel-removes path.
  const store = new ArtifactsStore({ projectRoot, scenarioId });

  return { scenarioPath, store };
}

// --- Tests ------------------------------------------------------------------

describe('recorder end-to-end (record → save → cleanup)', () => {
  let tmp;
  let scenarioId;
  let scenarioPath;
  let scenariosDir;
  let publicScreenshotsDir;
  let bundleRoot;
  let exitCode;
  let store;

  beforeAll(async () => {
    scenarioId = 'login_flow';
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-e2e-'));

    // Seed config.json — the project-root contract setup writes.
    fs.mkdirSync(path.join(tmp, 'mobile-automator'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'mobile-automator', 'config.json'),
      JSON.stringify({ mode: 'platform-aware', project_name: 'demo' })
    );

    // (1) Drive the real lifecycle to produce the artifact bundle.
    const script = JSON.parse(fs.readFileSync(SCRIPTED_SESSION_FIXTURE_PATH, 'utf8'));
    await runScriptedSession({ projectRoot: tmp, scenarioId, script });

    bundleRoot = path.join(tmp, 'mobile-automator', '.recorder', scenarioId);
    expect(fs.existsSync(bundleRoot)).toBe(true); // sanity — lifecycle ran

    // (2) Mock-AI synthesis: bundle → scenario JSON + screenshots. Slice 8:
    //     synthesis no longer deletes the bundle (Save persists it).
    const out = synthesizeScenario(tmp, scenarioId);
    scenarioPath = out.scenarioPath;
    store = out.store;
    scenariosDir = path.join(tmp, 'mobile-automator', 'scenarios');
    publicScreenshotsDir = path.join(tmp, 'mobile-automator', 'screenshots', scenarioId);

    // (3) Drive handleSaveMessage with an injected onDone — captures the
    //     signalled exit code without invoking process.exit (forbidden in
    //     test path per Task 2.6).
    handleSaveMessage({
      store: out.store,
      onDone: (code) => {
        exitCode = code;
      },
    });
  });

  afterAll(() => {
    if (tmp && fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('A. mobile-automator/scenarios/<id>.json exists', () => {
    expect(fs.existsSync(scenarioPath)).toBe(true);
    expect(fs.statSync(scenarioPath).isFile()).toBe(true);
  });

  test('A. scenario JSON validates against the v2.1 schema', () => {
    const schema = JSON.parse(fs.readFileSync(SCENARIO_SCHEMA_PATH, 'utf8'));
    const scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));
    const errors = validateScenarioAgainstSchema(scenario, schema);
    if (errors.length > 0) {
      // eslint-disable-next-line no-console
      console.error('Schema errors:', errors);
    }
    expect(errors).toEqual([]);
    expect(scenario.$schema_version).toBe('2.1');
    expect(scenario.scenario_id).toBe(scenarioId);
    // The lifecycle emits one tap event for the scripted-session fixture
    // (one down/up pair coalesced into a single tap), so at least one step.
    expect(scenario.steps.length).toBeGreaterThanOrEqual(1);
    for (const step of scenario.steps) expect(step.action).toBe('tap');
  });

  test('B. mobile-automator/screenshots/<id>/ exists', () => {
    expect(fs.existsSync(publicScreenshotsDir)).toBe(true);
    expect(fs.statSync(publicScreenshotsDir).isDirectory()).toBe(true);
  });

  test('C. mobile-automator/.recorder/<id>/ PERSISTS after the Save flow', () => {
    // Slice 8 decouples recording from synthesis: a successful Save keeps the
    // bundle so the offline `mauto record-bundle <id>` step can read it.
    expect(fs.existsSync(bundleRoot)).toBe(true);
  });

  test('C. a subsequent Cancel removes the persisted bundle', () => {
    // Runs after the persist assertion (Jest preserves declaration order).
    // CANCEL is still the destructive path: cleanupOnCancel nukes the tree.
    handleCancelMessage({ store, onDone: () => {} });
    expect(fs.existsSync(bundleRoot)).toBe(false);
  });

  test('handleSaveMessage signalled exit code 0 (no process.exit)', () => {
    expect(exitCode).toBe(0);
  });

  test('public scenarios/ directory holds exactly the expected scenario file', () => {
    const entries = fs.readdirSync(scenariosDir);
    expect(entries).toContain(`${scenarioId}.json`);
  });
});

// Slice #24: gesture variety. Drives the same lifecycle + synthesis pipeline
// against a fixture that exercises one of each v1 gesture (tap, long_press,
// double_tap, swipe) and pins the invariant that all four flow through to a
// schema-valid scenario JSON. This sits as a sibling describe to preserve
// the existing tap-only block as a focused regression guard.

const GESTURES_FIXTURE_PATH = path.join(
  REPO_ROOT,
  'tests',
  'fixtures',
  'recorder',
  'scripted-session-gestures.json'
);

describe('recorder end-to-end (gesture variety: long-press / double-tap / swipe)', () => {
  let tmp;
  let scenarioId;
  let scenarioPath;
  let bundleRoot;
  let scenario;

  beforeAll(async () => {
    scenarioId = 'gesture_variety';
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-e2e-gestures-'));

    fs.mkdirSync(path.join(tmp, 'mobile-automator'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'mobile-automator', 'config.json'),
      JSON.stringify({ mode: 'platform-aware', project_name: 'demo' })
    );

    const script = JSON.parse(fs.readFileSync(GESTURES_FIXTURE_PATH, 'utf8'));
    await runScriptedSession({ projectRoot: tmp, scenarioId, script });

    bundleRoot = path.join(tmp, 'mobile-automator', '.recorder', scenarioId);
    expect(fs.existsSync(bundleRoot)).toBe(true);

    const out = synthesizeScenario(tmp, scenarioId);
    scenarioPath = out.scenarioPath;
    scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));

    handleSaveMessage({ store: out.store, onDone: () => {} });
  });

  afterAll(() => {
    if (tmp && fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('scenario JSON validates against the v2.1 schema', () => {
    const schema = JSON.parse(fs.readFileSync(SCENARIO_SCHEMA_PATH, 'utf8'));
    const errors = validateScenarioAgainstSchema(scenario, schema);
    if (errors.length > 0) {
      // eslint-disable-next-line no-console
      console.error('Schema errors:', errors);
    }
    expect(errors).toEqual([]);
  });

  test('scenario steps preserve chronological emission order from the fixture', () => {
    // Array-equality (not set-equality) so a reordering bug in either the
    // lifecycle's emit path or the synthesizer's step mapping shows up here.
    const actions = scenario.steps.map((s) => s.action);
    expect(actions).toEqual(['tap', 'long_press', 'double_tap', 'swipe']);
  });

  test('swipe step carries direction in the value field', () => {
    const swipe = scenario.steps.find((s) => s.action === 'swipe');
    expect(swipe).toBeDefined();
    expect(swipe.value).toBe('up');
  });

  test('each step targets the element under its gesture coords', () => {
    const byAction = Object.fromEntries(scenario.steps.map((s) => [s.action, s]));
    expect(byAction.tap.target).toBe('Item Card');
    expect(byAction.long_press.target).toBe('Settings Icon');
    expect(byAction.double_tap.target).toBe('Like Button');
    expect(byAction.swipe.target).toBe('Feed');
  });

  test('step ids encode gesture kind and target', () => {
    const ids = scenario.steps.map((s) => s.id);
    expect(ids).toContain('tap_item_card');
    expect(ids).toContain('long_press_settings_icon');
    expect(ids).toContain('double_tap_like_button');
    expect(ids).toContain('swipe_feed');
  });
});
