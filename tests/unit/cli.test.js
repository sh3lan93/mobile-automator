'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

const {
  handleElements,
  handleScreenshot,
  handleValidate,
  handleTap,
  handleType,
  handleSwipe,
  handlePress,
  handleAssert,
  handleResultAddStep,
  handleResultFinalize,
  handleSetup,
  handleConfigGet,
  handleConfigSet,
  handleGuide,
  handleSchema,
  handleBootstrap,
  handleInit,
  handleRecordBundle,
} = require('../../src/cli');
const Ajv = require('ajv');

const RESULT_SCHEMA_PATH = path.resolve(
  __dirname,
  '../../templates/mobile-automator-executor/references/result_schema.json'
);
const { ScenarioValidator } = require('../../src/scenario/validator');

const SCHEMA_PATH = path.resolve(
  __dirname,
  '../../templates/mobile-automator-generator/references/scenario_schema.json'
);

function validScenario() {
  return {
    $schema_version: '2.1',
    scenario_id: 'login_smoke',
    name: 'Login smoke',
    description: 'Verifies the user can reach the login screen.',
    platform: 'cross-platform',
    app_package: 'com.example.app',
    metadata: { app_version: 'staging-latest', environment: 'staging' },
    steps: [{ id: 'launch', action: 'launch_app', description: 'Launch the app' }],
    assertions: [
      {
        id: 'login_visible',
        after_step: 'launch',
        type: 'element_exists',
        description: 'Login button is present',
      },
    ],
  };
}

function writeTmp(name, contents) {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-')), name);
  fs.writeFileSync(p, contents);
  return p;
}

describe('cli handlers', () => {
  describe('handleElements', () => {
    test('returns ok envelope with the agnostic elements from the bridge', async () => {
      const fakeBridge = {
        listElements: async () => [
          { text: 'A', accessibility_label: null, bounds: [0, 0, 2, 2], center: [1, 1], type: 'B' },
        ],
      };
      const { envelope, exitKind } = await handleElements({ deviceBridge: fakeBridge });
      expect(exitKind).toBe('ok');
      expect(envelope.ok).toBe(true);
      expect(envelope.data).toHaveLength(1);
      expect(JSON.stringify(envelope)).not.toMatch(/resource_id/);
    });

    test('returns a device-fail envelope when the bridge throws', async () => {
      const fakeBridge = {
        listElements: async () => {
          throw new Error('no device connected');
        },
      };
      const { envelope, exitKind } = await handleElements({ deviceBridge: fakeBridge });
      expect(exitKind).toBe('device');
      expect(envelope.ok).toBe(false);
      expect(envelope.error.kind).toBe('device');
      expect(envelope.error.message).toMatch(/no device connected/);
    });
  });

  describe('handleScreenshot', () => {
    test('returns ok envelope with the saved path', async () => {
      const fakeBridge = { screenshot: async (p) => p };
      const { envelope, exitKind } = await handleScreenshot(
        { deviceBridge: fakeBridge },
        '/tmp/shot.png'
      );
      expect(exitKind).toBe('ok');
      expect(envelope.data).toEqual({ path: '/tmp/shot.png' });
    });
  });

  describe('handleValidate', () => {
    test('valid scenario -> ok envelope, exitKind ok', () => {
      const file = writeTmp('s.json', JSON.stringify(validScenario()));
      const validator = new ScenarioValidator({ schemaPath: SCHEMA_PATH });
      const { envelope, exitKind } = handleValidate({ validator }, file);
      expect(exitKind).toBe('ok');
      expect(envelope.ok).toBe(true);
      expect(envelope.data).toEqual({ valid: true });
    });

    test('invalid scenario -> invalid_input fail, exitKind invalid_input, errors in data', () => {
      const bad = validScenario();
      delete bad.app_package;
      const file = writeTmp('bad.json', JSON.stringify(bad));
      const validator = new ScenarioValidator({ schemaPath: SCHEMA_PATH });
      const { envelope, exitKind } = handleValidate({ validator }, file);
      expect(exitKind).toBe('invalid_input');
      expect(envelope.ok).toBe(false);
      expect(envelope.error.kind).toBe('invalid_input');
      expect(Array.isArray(envelope.data.errors)).toBe(true);
      expect(envelope.data.errors.length).toBeGreaterThan(0);
    });

    test('unreadable / unparseable file -> invalid_input fail', () => {
      const file = writeTmp('broken.json', '{ not valid json');
      const validator = new ScenarioValidator({ schemaPath: SCHEMA_PATH });
      const { envelope, exitKind } = handleValidate({ validator }, file);
      expect(exitKind).toBe('invalid_input');
      expect(envelope.ok).toBe(false);
      expect(envelope.error.kind).toBe('invalid_input');
    });

    test('missing file -> invalid_input fail', () => {
      const validator = new ScenarioValidator({ schemaPath: SCHEMA_PATH });
      const { envelope, exitKind } = handleValidate(
        { validator },
        '/no/such/file/here.json'
      );
      expect(exitKind).toBe('invalid_input');
      expect(envelope.ok).toBe(false);
    });
  });

  describe('handleTap', () => {
    test('parses "x,y" and taps via the bridge', async () => {
      const calls = [];
      const bridge = { tap: async (c) => { calls.push(c); } };
      const { envelope, exitKind } = await handleTap({ deviceBridge: bridge }, '12,34');
      expect(exitKind).toBe('ok');
      expect(envelope.data).toEqual({ tapped: [12, 34] });
      expect(calls).toEqual([{ x: 12, y: 34 }]);
    });

    test('rejects bad coordinate format with invalid_input exit 3', async () => {
      const bridge = { tap: async () => { throw new Error('should not be called'); } };
      const { envelope, exitKind } = await handleTap({ deviceBridge: bridge }, 'nope');
      expect(exitKind).toBe('invalid_input');
      expect(envelope.ok).toBe(false);
      expect(envelope.error.kind).toBe('invalid_input');
    });
  });

  describe('handleType', () => {
    test('types text and reports the length', async () => {
      const calls = [];
      const bridge = { type: async (t) => { calls.push(t); } };
      const { envelope, exitKind } = await handleType({ deviceBridge: bridge }, 'hello');
      expect(exitKind).toBe('ok');
      expect(calls).toEqual(['hello']);
      expect(envelope.data.typed).toBe(5);
    });
  });

  describe('handleSwipe', () => {
    test('swipes a valid direction', async () => {
      const calls = [];
      const bridge = { swipe: async (c) => { calls.push(c); } };
      const { envelope, exitKind } = await handleSwipe({ deviceBridge: bridge }, 'up');
      expect(exitKind).toBe('ok');
      expect(envelope.data).toEqual({ swiped: 'up' });
      expect(calls).toEqual([{ direction: 'up' }]);
    });

    test('rejects an invalid direction with invalid_input', async () => {
      const bridge = { swipe: async () => { throw new Error('nope'); } };
      const { envelope, exitKind } = await handleSwipe({ deviceBridge: bridge }, 'sideways');
      expect(exitKind).toBe('invalid_input');
      expect(envelope.error.kind).toBe('invalid_input');
    });
  });

  describe('handlePress', () => {
    test('presses a button', async () => {
      const calls = [];
      const bridge = { pressButton: async (b) => { calls.push(b); } };
      const { envelope, exitKind } = await handlePress({ deviceBridge: bridge }, 'BACK');
      expect(exitKind).toBe('ok');
      expect(envelope.data).toEqual({ pressed: 'BACK' });
      expect(calls).toEqual(['BACK']);
    });
  });

  describe('handleAssert', () => {
    const fakeBridge = (els) => ({ listElements: async () => els });

    test('mechanical pass: lists elements, evaluates, exit 0', async () => {
      const els = [
        { text: 'Login', accessibility_label: null, bounds: [0, 0, 2, 2], center: [1, 1], type: null },
      ];
      const { envelope, exitKind } = await handleAssert(
        { deviceBridge: fakeBridge(els) },
        'element_exists',
        { target: 'Login' }
      );
      expect(exitKind).toBe('ok'); // failed assertion is still exit 0
      expect(envelope.ok).toBe(true);
      expect(envelope.data.mechanical).toBe(true);
      expect(envelope.data.pass).toBe(true);
      expect(envelope.data.needs_agent).toBe(false);
    });

    test('mechanical fail still returns ok envelope, exit 0', async () => {
      const { envelope, exitKind } = await handleAssert(
        { deviceBridge: fakeBridge([]) },
        'element_exists',
        { target: 'Login' }
      );
      expect(exitKind).toBe('ok');
      expect(envelope.data.pass).toBe(false);
    });

    test('non-mechanical passes through as needs_agent', async () => {
      const { envelope, exitKind } = await handleAssert(
        { deviceBridge: fakeBridge([]) },
        'screenshot_match',
        {}
      );
      expect(exitKind).toBe('ok');
      expect(envelope.data.needs_agent).toBe(true);
      expect(envelope.data.pass).toBeNull();
    });

    test('unknown type is a structural error -> invalid_input exit 3', async () => {
      const { envelope, exitKind } = await handleAssert(
        { deviceBridge: fakeBridge([]) },
        'totally_made_up',
        {}
      );
      expect(exitKind).toBe('invalid_input');
      expect(envelope.error.kind).toBe('invalid_input');
    });
  });

  describe('handleResultAddStep -> handleResultFinalize round-trip', () => {
    test('writes a schema-conformant result to a tmp projectRoot', async () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-cli-'));
      const runId = 'run_20260614_120000';
      const factory = ({ runId: rid, scenarioId, projectRoot: pr }) =>
        new (require('../../src/result/store').ResultStore)({ runId: rid, scenarioId, projectRoot: pr });

      const deps = { resultStoreFactory: factory, projectRoot };

      const a = handleResultAddStep(deps, {
        runId,
        scenarioId: 'login_smoke',
        stepId: 'launch',
        status: 'pass',
      });
      expect(a.exitKind).toBe('ok');

      const f = handleResultFinalize(deps, { runId, status: 'passed', duration: 5 });
      expect(f.exitKind).toBe('ok');
      expect(f.envelope.data.run_id).toBe(runId);

      const schema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, 'utf8'));
      const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
      expect(validate(f.envelope.data)).toBe(true);
    });
  });

  // --- Slice 3: workspace + reasoning-delivery floor ----------------------

  describe('handleSetup', () => {
    test('scaffolds into an injected projectRoot and maps aware->platform-aware', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-setup-'));
      const { envelope, exitKind } = handleSetup({ projectRoot }, { mode: 'aware' });
      expect(exitKind).toBe('ok');
      expect(envelope.ok).toBe(true);
      expect(envelope.data.mode).toBe('platform-aware');
      expect(envelope.data.next).toContain('mauto guide setup');
      expect(fs.existsSync(path.join(projectRoot, 'mobile-automator', 'scenarios'))).toBe(true);
    });

    test('maps agnostic->platform-agnostic and writes config mode', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-setup-'));
      const { envelope } = handleSetup({ projectRoot }, { mode: 'agnostic' });
      expect(envelope.data.mode).toBe('platform-agnostic');
      const cfg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'mobile-automator', 'config.json'), 'utf8'));
      expect(cfg.mode).toBe('platform-agnostic');
    });

    test('defaults to platform-aware when no --mode given', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-setup-'));
      const { envelope } = handleSetup({ projectRoot }, {});
      expect(envelope.data.mode).toBe('platform-aware');
    });

    test('rejects an unknown mode', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-setup-'));
      const { exitKind } = handleSetup({ projectRoot }, { mode: 'windows' });
      expect(exitKind).toBe('invalid_input');
    });
  });

  describe('config get/set', () => {
    test('set then get round-trips with JSON-parsed values', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-cfg-'));
      const setR = handleConfigSet({ projectRoot }, 'app_package', 'com.example.app');
      expect(setR.exitKind).toBe('ok');
      const getR = handleConfigGet({ projectRoot }, 'app_package');
      expect(getR.envelope.data).toEqual({ key: 'app_package', value: 'com.example.app' });
    });

    test('set parses JSON arrays/numbers when possible', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-cfg-'));
      handleConfigSet({ projectRoot }, 'business_critical_paths', '["checkout","login"]');
      const getR = handleConfigGet({ projectRoot }, 'business_critical_paths');
      expect(getR.envelope.data.value).toEqual(['checkout', 'login']);
    });

    test('get of a missing key returns undefined value', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-cfg-'));
      const getR = handleConfigGet({ projectRoot }, 'nope');
      expect(getR.exitKind).toBe('ok');
      expect(getR.envelope.data.value).toBeUndefined();
    });
  });

  describe('handleGuide (raw content / fail on unknown)', () => {
    test('returns raw markdown for a known topic resolving mode from config', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-guide-'));
      handleConfigSet({ projectRoot }, 'mode', 'platform-agnostic');
      const r = handleGuide({ projectRoot }, 'execute');
      expect(r.exitKind).toBe('ok');
      expect(r.raw).toContain('mauto');
      expect(r.raw).toContain('press_back');
      expect(r.envelope).toBeUndefined();
    });

    test('defaults to platform-aware when no config present', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-guide-'));
      const r = handleGuide({ projectRoot }, 'setup');
      expect(r.exitKind).toBe('ok');
      expect(typeof r.raw).toBe('string');
    });

    test('unknown topic -> fail envelope + invalid_input exit 3', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-guide-'));
      const r = handleGuide({ projectRoot }, 'bogus');
      expect(r.exitKind).toBe('invalid_input');
      expect(r.envelope.error.kind).toBe('invalid_input');
      expect(r.raw).toBeUndefined();
    });
  });

  describe('handleSchema (raw JSON / fail on unknown)', () => {
    test('returns raw JSON for scenario', () => {
      const r = handleSchema({}, 'scenario');
      expect(r.exitKind).toBe('ok');
      expect(() => JSON.parse(r.raw)).not.toThrow();
    });

    test('unknown name -> fail envelope exit 3', () => {
      const r = handleSchema({}, 'bogus');
      expect(r.exitKind).toBe('invalid_input');
      expect(r.envelope.error.kind).toBe('invalid_input');
    });
  });

  describe('handleBootstrap (raw text)', () => {
    test('returns the verb map as raw text', () => {
      const r = handleBootstrap({});
      expect(r.exitKind).toBe('ok');
      expect(r.raw).toContain('elements');
      expect(r.raw).toContain('schema');
      expect(r.raw).not.toMatch(/\bmobile_[a-z_]+/);
    });
  });

  describe('handleInit (vendor adapters)', () => {
    test('claude applies into the injected projectRoot and returns written/merged', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-init-h-'));
      const { envelope, exitKind } = handleInit({ projectRoot }, 'claude');
      expect(exitKind).toBe('ok');
      expect(envelope.ok).toBe(true);
      expect(envelope.data.agent).toBe('claude');
      expect(Array.isArray(envelope.data.written)).toBe(true);
      expect(Array.isArray(envelope.data.merged)).toBe(true);
      expect(fs.existsSync(path.join(projectRoot, '.mcp.json'))).toBe(true);
    });

    test('cursor applies and returns the cursor agent', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-init-h-'));
      const { envelope, exitKind } = handleInit({ projectRoot }, 'cursor');
      expect(exitKind).toBe('ok');
      expect(envelope.data.agent).toBe('cursor');
    });

    test('unknown agent -> invalid_input', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-init-h-'));
      const { envelope, exitKind } = handleInit({ projectRoot }, 'bogus');
      expect(exitKind).toBe('invalid_input');
      expect(envelope.ok).toBe(false);
      expect(envelope.error.kind).toBe('invalid_input');
      expect(envelope.hint).toContain('claude');
    });
  });

  describe('handleRecordBundle (read persisted recorder bundle)', () => {
    const REPO_ROOT = path.resolve(__dirname, '..', '..');
    const FIXTURE = path.join(REPO_ROOT, 'tests', 'fixtures', 'recorder', 'sample-bundle');

    function copyTree(src, dest) {
      fs.mkdirSync(dest, { recursive: true });
      for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isDirectory()) copyTree(s, d);
        else fs.copyFileSync(s, d);
      }
    }

    function seed(scenarioId) {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-recbundle-'));
      copyTree(FIXTURE, path.join(projectRoot, 'mobile-automator', '.recorder', scenarioId));
      return projectRoot;
    }

    test('reads the bundle envelope (events parsed, hierarchy listed)', () => {
      const projectRoot = seed('login_flow');
      const { envelope, exitKind } = handleRecordBundle({ projectRoot }, 'login_flow', {});
      expect(exitKind).toBe('ok');
      expect(envelope.ok).toBe(true);
      expect(envelope.data.scenario_id).toBe('login_flow');
      expect(envelope.data.events).toHaveLength(3);
      expect(envelope.data.hierarchy).toHaveLength(2);
      // Without --consume the bundle is left in place.
      expect(fs.existsSync(path.join(projectRoot, 'mobile-automator', '.recorder', 'login_flow'))).toBe(true);
    });

    test('--consume deletes the bundle after a successful read', () => {
      const projectRoot = seed('login_flow');
      const { envelope, exitKind } = handleRecordBundle({ projectRoot }, 'login_flow', { consume: true });
      expect(exitKind).toBe('ok');
      expect(envelope.data.consumed).toBe(true);
      expect(fs.existsSync(path.join(projectRoot, 'mobile-automator', '.recorder', 'login_flow'))).toBe(false);
    });

    test('missing bundle -> invalid_input (exit 3) with a record hint', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-recbundle-missing-'));
      const { envelope, exitKind } = handleRecordBundle({ projectRoot }, 'nope', {});
      expect(exitKind).toBe('invalid_input');
      expect(envelope.ok).toBe(false);
      expect(envelope.error.kind).toBe('invalid_input');
      expect(envelope.error.message).toContain('no recording bundle for nope');
      expect(envelope.hint).toContain('mauto record');
    });
  });
});
