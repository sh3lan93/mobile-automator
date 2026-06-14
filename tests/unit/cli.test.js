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
});
