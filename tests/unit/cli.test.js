'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

const {
  handleElements,
  handleScreenshot,
  handleValidate,
  handleTap,
  handleLongPress,
  handleDoubleTap,
  handleType,
  handleSwipe,
  handlePress,
  handleLaunch,
  handleInstall,
  handleUninstall,
  handleOpenUrl,
  handleOrientation,
  handleAssert,
  handleResultAddStep,
  handleResultAddAssertion,
  handleResultFinalize,
  handleSetup,
  handleConfigGet,
  handleConfigSet,
  handleGuide,
  handleSchema,
  handleBootstrap,
  handleInit,
  handleSessionStart,
  handleSessionStatus,
  handleSessionEnd,
  handleDevices,
  handleDevicesUse,
  handleDevicesClear,
  buildProgram,
} = require('../../src/cli');
const selectionStore = require('../../src/device/selection');
const sessionPaths = require('../../src/device/session-paths');
const Ajv = require('ajv');

const RESULT_SCHEMA_PATH = path.resolve(
  __dirname,
  '../../src/schemas/result_schema.json'
);
const { ScenarioValidator } = require('../../src/scenario/validator');

const SCHEMA_PATH = path.resolve(
  __dirname,
  '../../src/schemas/scenario_schema.json'
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
  function tmpDeps() {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-cli-'));
    const factory = ({ runId: rid, scenarioId, projectRoot: pr }) =>
      new (require('../../src/result/store').ResultStore)({ runId: rid, scenarioId, projectRoot: pr });
    return { resultStoreFactory: factory, projectRoot };
  }

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

    test('handleElements surfaces a DeviceResolutionError hint into the envelope', async () => {
      const { DeviceResolutionError } = require('../../src/device/device-resolver');
      const deviceBridge = { listElements: async () => { throw new DeviceResolutionError('No active device or emulator found.', 'Start an emulator/simulator (or connect a device), or pass --device <id>.'); } };
      const { envelope, exitKind } = await handleElements({ deviceBridge });
      expect(exitKind).toBe('device');
      expect(envelope.ok).toBe(false);
      expect(envelope.error.kind).toBe('device');
      expect(envelope.hint).toContain('--device');
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

    test('rejects an empty/whitespace coordinate part (Number("") === 0 trap)', async () => {
      const bridge = { tap: async () => { throw new Error('should not be called'); } };
      for (const raw of ['10,', ',20', ' , ', '10, ']) {
        const { exitKind } = await handleTap({ deviceBridge: bridge }, raw);
        expect(exitKind).toBe('invalid_input');
      }
    });
  });

  describe('handleLongPress', () => {
    test('parses "x,y" and long-presses via the bridge (no duration)', async () => {
      const calls = [];
      const bridge = { longPress: async (c) => { calls.push(c); } };
      const { envelope, exitKind } = await handleLongPress({ deviceBridge: bridge }, '12,34');
      expect(exitKind).toBe('ok');
      expect(envelope.data).toEqual({ long_pressed: [12, 34] });
      expect(calls).toEqual([{ x: 12, y: 34 }]);
    });

    test('passes a valid duration through to the bridge and reports it', async () => {
      const calls = [];
      const bridge = { longPress: async (c) => { calls.push(c); } };
      const { envelope, exitKind } = await handleLongPress(
        { deviceBridge: bridge },
        '5,6',
        { duration: '800' }
      );
      expect(exitKind).toBe('ok');
      expect(envelope.data).toEqual({ long_pressed: [5, 6], duration: 800 });
      expect(calls).toEqual([{ x: 5, y: 6, duration: 800 }]);
    });

    test('rejects bad coordinate format with invalid_input', async () => {
      const bridge = { longPress: async () => { throw new Error('should not be called'); } };
      const { envelope, exitKind } = await handleLongPress({ deviceBridge: bridge }, 'nope');
      expect(exitKind).toBe('invalid_input');
      expect(envelope.error.kind).toBe('invalid_input');
    });

    test('rejects a non-positive / non-integer duration with invalid_input', async () => {
      const bridge = { longPress: async () => { throw new Error('should not be called'); } };
      const { exitKind } = await handleLongPress({ deviceBridge: bridge }, '1,2', { duration: '-5' });
      expect(exitKind).toBe('invalid_input');
      const bad = await handleLongPress({ deviceBridge: bridge }, '1,2', { duration: 'soon' });
      expect(bad.exitKind).toBe('invalid_input');
    });
  });

  describe('handleDoubleTap', () => {
    test('parses "x,y" and double-taps via the bridge', async () => {
      const calls = [];
      const bridge = { doubleTap: async (c) => { calls.push(c); } };
      const { envelope, exitKind } = await handleDoubleTap({ deviceBridge: bridge }, '12,34');
      expect(exitKind).toBe('ok');
      expect(envelope.data).toEqual({ double_tapped: [12, 34] });
      expect(calls).toEqual([{ x: 12, y: 34 }]);
    });

    test('rejects bad coordinate format with invalid_input', async () => {
      const bridge = { doubleTap: async () => { throw new Error('should not be called'); } };
      const { envelope, exitKind } = await handleDoubleTap({ deviceBridge: bridge }, 'nope');
      expect(exitKind).toBe('invalid_input');
      expect(envelope.error.kind).toBe('invalid_input');
    });
  });

  describe('handleLaunch', () => {
    test('launches an app and reports the id', async () => {
      const calls = [];
      const bridge = { launchApp: async (a) => { calls.push(a); } };
      const { envelope, exitKind } = await handleLaunch({ deviceBridge: bridge }, 'com.example.app');
      expect(exitKind).toBe('ok');
      expect(envelope.data).toEqual({ launched: 'com.example.app' });
      expect(calls).toEqual(['com.example.app']);
    });

    test('rejects a missing appId with invalid_input', async () => {
      const bridge = { launchApp: async () => { throw new Error('should not be called'); } };
      const { envelope, exitKind } = await handleLaunch({ deviceBridge: bridge }, '');
      expect(exitKind).toBe('invalid_input');
      expect(envelope.error.kind).toBe('invalid_input');
      expect(envelope.hint).toBeTruthy();
    });
  });

  describe('handleInstall', () => {
    test('installs an app and reports the path', async () => {
      const calls = [];
      const bridge = { installApp: async (p) => { calls.push(p); } };
      const { envelope, exitKind } = await handleInstall({ deviceBridge: bridge }, './app.apk');
      expect(exitKind).toBe('ok');
      expect(envelope.data).toEqual({ installed: './app.apk' });
      expect(calls).toEqual(['./app.apk']);
    });

    test('rejects a missing path with invalid_input', async () => {
      const bridge = { installApp: async () => { throw new Error('should not be called'); } };
      const { exitKind } = await handleInstall({ deviceBridge: bridge }, '');
      expect(exitKind).toBe('invalid_input');
    });
  });

  describe('handleUninstall', () => {
    test('uninstalls an app and reports the id', async () => {
      const calls = [];
      const bridge = { uninstallApp: async (a) => { calls.push(a); } };
      const { envelope, exitKind } = await handleUninstall({ deviceBridge: bridge }, 'com.example.app');
      expect(exitKind).toBe('ok');
      expect(envelope.data).toEqual({ uninstalled: 'com.example.app' });
      expect(calls).toEqual(['com.example.app']);
    });

    test('rejects a missing appId with invalid_input', async () => {
      const bridge = { uninstallApp: async () => { throw new Error('should not be called'); } };
      const { exitKind } = await handleUninstall({ deviceBridge: bridge }, '');
      expect(exitKind).toBe('invalid_input');
    });
  });

  describe('handleOpenUrl', () => {
    test('opens a url and reports it', async () => {
      const calls = [];
      const bridge = { openUrl: async (u) => { calls.push(u); } };
      const { envelope, exitKind } = await handleOpenUrl({ deviceBridge: bridge }, 'https://example.com');
      expect(exitKind).toBe('ok');
      expect(envelope.data).toEqual({ opened: 'https://example.com' });
      expect(calls).toEqual(['https://example.com']);
    });

    test('rejects a missing url with invalid_input', async () => {
      const bridge = { openUrl: async () => { throw new Error('should not be called'); } };
      const { exitKind } = await handleOpenUrl({ deviceBridge: bridge }, '');
      expect(exitKind).toBe('invalid_input');
    });
  });

  describe('handleOrientation', () => {
    test('sets a valid orientation via the bridge', async () => {
      const calls = [];
      const bridge = { setOrientation: async (o) => { calls.push(o); } };
      const { envelope, exitKind } = await handleOrientation({ deviceBridge: bridge }, 'landscape');
      expect(exitKind).toBe('ok');
      expect(envelope.data).toEqual({ orientation: 'landscape' });
      expect(calls).toEqual(['landscape']);
    });

    test('rejects an invalid orientation with invalid_input', async () => {
      const bridge = { setOrientation: async () => { throw new Error('should not be called'); } };
      const { envelope, exitKind } = await handleOrientation({ deviceBridge: bridge }, 'sideways');
      expect(exitKind).toBe('invalid_input');
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
    test('hardware button still passes straight through to pressButton', async () => {
      const calls = [];
      const bridge = { pressButton: async (b) => { calls.push(b); } };
      const { envelope, exitKind } = await handlePress({ deviceBridge: bridge }, 'BACK');
      expect(exitKind).toBe('ok');
      expect(envelope.data).toEqual({ pressed: 'BACK' });
      expect(calls).toEqual(['BACK']);
    });

    test('semantic press_back resolves per platform and reports the mechanism', async () => {
      const calls = [];
      const bridge = {
        getPlatform: async () => 'android',
        pressButton: async (b) => { calls.push(['pressButton', b]); },
      };
      const { envelope, exitKind } = await handlePress({ deviceBridge: bridge }, 'press_back');
      expect(exitKind).toBe('ok');
      expect(envelope.data).toEqual({
        pressed: 'press_back',
        resolved: { platform: 'android', mechanism: 'button:BACK' },
      });
      expect(calls).toEqual([['pressButton', 'BACK']]);
    });

    test('an unresolvable semantic action hard-fails (ok:false), never forwards', async () => {
      const bridge = {
        getPlatform: async () => 'android',
        listElements: async () => [], // no Allow button on screen
        tap: async () => {},
      };
      const { envelope, exitKind } = await handlePress({ deviceBridge: bridge }, 'grant_permission');
      expect(exitKind).toBe('device');
      expect(envelope.ok).toBe(false);
      expect(envelope.error.kind).toBe('device');
    });

    test('empty action is invalid input', async () => {
      const { exitKind } = await handlePress({ deviceBridge: {} }, '');
      expect(exitKind).toBe('invalid_input');
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

  describe('handleAssert recording hint', () => {
    const bridge = { listElements: async () => [{ accessibility_label: 'Login', text: 'Login' }] };

    test('a mechanical verdict hints the exact recording command with the decided value', async () => {
      const r = await handleAssert({ deviceBridge: bridge }, 'element_exists', { target: 'Login' });
      expect(r.exitKind).toBe('ok');
      expect(r.envelope.data.mechanical).toBe(true);
      expect(r.envelope.hint).toContain('mauto result add-assertion');
      expect(r.envelope.hint).toContain('--type element_exists');
      expect(r.envelope.hint).toContain(`--pass ${r.envelope.data.pass}`);
      // The hint is copied verbatim, so it must never omit --message: for
      // Tier-2 verdicts the message IS the evidence (#140 fix-wave FIX 3).
      expect(r.envelope.hint).toContain('--message');
    });

    test('an agent-judged verdict hints a placeholder instead of a decided value, and still includes --message', async () => {
      const r = await handleAssert({ deviceBridge: bridge }, 'screenshot_match', { target: 'ref.png' });
      expect(r.envelope.data.needs_agent).toBe(true);
      expect(r.envelope.hint).toContain('--pass <your verdict>');
      expect(r.envelope.hint).toContain('--message');
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

    test('threads a corruption warning into the success envelope hint', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-cli-'));
      const runId = 'run_20260614_130000';
      const dir = path.join(projectRoot, 'mobile-automator', 'results');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${runId}.json`), '{ truncated <<<');

      const factory = ({ runId: rid, scenarioId, projectRoot: pr }) =>
        new (require('../../src/result/store').ResultStore)({ runId: rid, scenarioId, projectRoot: pr });
      const deps = { resultStoreFactory: factory, projectRoot };

      const a = handleResultAddStep(deps, { runId, stepId: 'launch', status: 'pass' });
      expect(a.exitKind).toBe('ok');
      expect(a.envelope.ok).toBe(true);
      // The corruption reaches the caller purely through the envelope hint
      // (the contract channel) — no stderr side-effect / console spy required.
      expect(a.envelope.hint).toMatch(/corrupt/i);
    });

    test('records screenshot, error_message, typed observations and captured variables', () => {
      const deps = tmpDeps();
      const runId = 'run_20260804_140000';

      const a = handleResultAddStep(deps, {
        runId,
        scenarioId: 'login_smoke',
        stepId: 'verify_home',
        status: 'fail',
        screenshot: 'mobile-automator/screenshots/verify_home.png',
        errorMessage: 'Login button not found',
        observation: ['regression:logo is gone', 'state_context:dark mode was active'],
        capture: ['order_id=A-1729'],
      });
      expect(a.exitKind).toBe('ok');
      expect(a.envelope.data.step.screenshot).toBe('mobile-automator/screenshots/verify_home.png');
      expect(a.envelope.data.step.error_message).toBe('Login button not found');

      const f = handleResultFinalize(deps, { runId, status: 'failed', duration: 3 });
      const types = f.envelope.data.observations.map((o) => o.type);
      expect(types).toEqual(['regression', 'state_context']);
      expect(f.envelope.data.observations[0].step_id).toBe('verify_home');
      expect(f.envelope.data.captured_variables).toEqual({ order_id: 'A-1729' });

      const schema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, 'utf8'));
      expect(new Ajv({ allErrors: true, strict: false }).compile(schema)(f.envelope.data)).toBe(true);
    });

    test('rejects an unknown observation type with invalid_input', () => {
      const deps = tmpDeps();
      const r = handleResultAddStep(deps, {
        runId: 'run_20260804_141000', stepId: 'verify', status: 'fail',
        observation: ['typo:something'],
      });
      expect(r.exitKind).toBe('invalid_input');
      expect(r.envelope.error.kind).toBe('invalid_input');
      expect(r.envelope.error.message).toMatch(/unknown observation type "typo"/);
    });

    test('writes NOTHING when a composite flag is invalid', () => {
      const deps = tmpDeps();
      const runId = 'run_20260804_142000';
      handleResultAddStep(deps, {
        runId, stepId: 'verify', status: 'fail',
        screenshot: 'shot.png',
        observation: ['typo:something'],
      });
      // The rejected invocation must not have half-recorded the step.
      const file = path.join(deps.projectRoot, 'mobile-automator', 'results', `${runId}.json`);
      expect(fs.existsSync(file)).toBe(false);
    });

    test('rejects a malformed capture spec with invalid_input', () => {
      const deps = tmpDeps();
      const r = handleResultAddStep(deps, {
        runId: 'run_20260804_143000', stepId: 'verify', status: 'pass',
        capture: ['order_id'],
      });
      expect(r.exitKind).toBe('invalid_input');
      expect(r.envelope.error.message).toMatch(/<name>=<value>/);
    });

    test('populates run metadata from flags and leaves the rest as unknown', () => {
      const deps = tmpDeps();
      const runId = 'run_20260804_170000';
      handleResultAddStep(deps, { runId, scenarioId: 's', stepId: 'launch', status: 'pass' });

      const f = handleResultFinalize(deps, {
        runId, status: 'passed', duration: 9,
        deviceModel: 'Pixel 7', apiLevel: '34',
      });
      expect(f.envelope.data.metadata.device_model).toBe('Pixel 7');
      expect(f.envelope.data.metadata.api_level).toBe('34');
      expect(f.envelope.data.metadata.app_version).toBe('unknown');
      expect(f.envelope.data.metadata.environment).toBe('unknown');
      expect(typeof f.envelope.data.metadata.timestamp).toBe('string');

      const schema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, 'utf8'));
      expect(new Ajv({ allErrors: true, strict: false }).compile(schema)(f.envelope.data)).toBe(true);
    });

    test('omitting every metadata flag keeps the previous all-unknown behaviour', () => {
      const deps = tmpDeps();
      const runId = 'run_20260804_171000';
      handleResultAddStep(deps, { runId, scenarioId: 's', stepId: 'launch', status: 'pass' });
      const f = handleResultFinalize(deps, { runId, status: 'passed', duration: 1 });
      expect(f.envelope.data.metadata.device_model).toBe('unknown');
    });

    test('a supplied --summary overrides the generated summary line', () => {
      const deps = tmpDeps();
      const runId = 'run_20260805_180000';
      handleResultAddStep(deps, { runId, scenarioId: 's', stepId: 'launch', status: 'pass' });
      const f = handleResultFinalize(deps, {
        runId, status: 'passed', duration: 2, summary: 'Login flow verified end to end.',
      });
      expect(f.envelope.data.summary).toBe('Login flow verified end to end.');
    });

    test('omitting --summary keeps the generated default summary', () => {
      const deps = tmpDeps();
      const runId = 'run_20260805_181000';
      handleResultAddStep(deps, { runId, scenarioId: 's', stepId: 'launch', status: 'pass' });
      const f = handleResultFinalize(deps, { runId, status: 'passed', duration: 2 });
      expect(f.envelope.data.summary).toBe('passed: 0/0 assertion(s) passed across 1 step(s).');
    });
  });

  describe('handleResultAddAssertion', () => {
    test('persists a verdict so the finalized counts are non-zero', () => {
      const deps = tmpDeps();
      const runId = 'run_20260804_160000';

      handleResultAddStep(deps, { runId, scenarioId: 's', stepId: 'verify', status: 'pass' });
      const a = handleResultAddAssertion(deps, {
        runId, stepId: 'verify', type: 'element_exists', pass: 'true', message: 'Login present',
      });
      expect(a.exitKind).toBe('ok');

      const b = handleResultAddAssertion(deps, {
        runId, stepId: 'verify', type: 'element_text', pass: 'false',
        message: 'wrong text', expected: 'Sign in', actual: 'Log in',
      });
      expect(b.exitKind).toBe('ok');

      const f = handleResultFinalize(deps, { runId, duration: 4 });
      expect(f.envelope.data.total_assertions).toBe(2);
      expect(f.envelope.data.passed_assertions).toBe(1);
      expect(f.envelope.data.failed_assertions).toBe(1);
      expect(f.envelope.data.status).toBe('failed'); // derived from the failed assertion
      expect(f.envelope.data.assertion_results[1]).toMatchObject({
        status: 'failed', expected: 'Sign in', actual: 'Log in',
      });

      const schema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, 'utf8'));
      expect(new Ajv({ allErrors: true, strict: false }).compile(schema)(f.envelope.data)).toBe(true);
    });

    test('rejects a non-boolean --pass with invalid_input', () => {
      const r = handleResultAddAssertion(tmpDeps(), {
        runId: 'run_20260804_161000', stepId: 'verify', type: 'element_exists', pass: 'yes',
      });
      expect(r.exitKind).toBe('invalid_input');
      expect(r.envelope.error.message).toMatch(/--pass must be "true" or "false"/);
    });

    test('rejects an unknown assertion type with invalid_input', () => {
      const r = handleResultAddAssertion(tmpDeps(), {
        runId: 'run_20260804_162000', stepId: 'verify', type: 'element_glows', pass: 'true',
      });
      expect(r.exitKind).toBe('invalid_input');
      expect(r.envelope.error.message).toMatch(/unknown assertion type "element_glows"/);
    });

    test('requires run-id, step-id, type and pass', () => {
      const r = handleResultAddAssertion(tmpDeps(), { runId: 'run_20260804_163000' });
      expect(r.exitKind).toBe('invalid_input');
      expect(r.envelope.error.message).toMatch(/--run-id, --step-id, --type and --pass are required/);
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

    test('coerces a comma-separated list key into an array (#136)', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-cfg-'));
      const setR = handleConfigSet({ projectRoot }, 'environments', 'stagingDebug,productionRelease');
      expect(setR.exitKind).toBe('ok');
      // The envelope echoes the coerced value, not the raw argument.
      expect(setR.envelope.data.value).toEqual(['stagingDebug', 'productionRelease']);
      // And it is a real JSON array on disk.
      const onDisk = JSON.parse(
        fs.readFileSync(path.join(projectRoot, 'mobile-automator', 'config.json'), 'utf8')
      );
      expect(onDisk.environments).toEqual(['stagingDebug', 'productionRelease']);
    });

    test('coerces the other two list keys the setup guide writes', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-cfg-'));
      handleConfigSet({ projectRoot }, 'protected_directories', 'src/, lib/');
      handleConfigSet({ projectRoot }, 'business_critical_paths', 'onboarding, login, checkout');
      expect(handleConfigGet({ projectRoot }, 'protected_directories').envelope.data.value).toEqual([
        'src/',
        'lib/',
      ]);
      expect(handleConfigGet({ projectRoot }, 'business_critical_paths').envelope.data.value).toEqual([
        'onboarding',
        'login',
        'checkout',
      ]);
    });

    test('keeps a numeric-looking string key a string', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-cfg-'));
      handleConfigSet({ projectRoot }, 'project_name', '12345');
      expect(handleConfigGet({ projectRoot }, 'project_name').envelope.data.value).toBe('12345');
    });

    test('rejects a value that violates its declared type, with a hint', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-cfg-'));
      const r = handleConfigSet({ projectRoot }, 'mode', 'windows');
      expect(r.exitKind).toBe('invalid_input');
      expect(r.envelope.ok).toBe(false);
      expect(r.envelope.error.kind).toBe('invalid_input');
      expect(r.envelope.hint).toMatch(/mauto schema config/);
      // Nothing was written.
      expect(
        fs.existsSync(path.join(projectRoot, 'mobile-automator', 'config.json'))
      ).toBe(false);
    });

    test('rejects a bare "null" on a non-nullable key instead of storing the string "null" (#136 fix-wave)', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-cfg-'));
      const r = handleConfigSet({ projectRoot }, 'build_command', 'null');
      expect(r.exitKind).toBe('invalid_input');
      expect(r.envelope.ok).toBe(false);
      expect(r.envelope.error.kind).toBe('invalid_input');
      // Nothing was written.
      expect(
        fs.existsSync(path.join(projectRoot, 'mobile-automator', 'config.json'))
      ).toBe(false);
    });

    test('a bare "null" on a nullable key stores JSON null', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-cfg-'));
      const r = handleConfigSet({ projectRoot }, 'project_name', 'null');
      expect(r.exitKind).toBe('ok');
      expect(handleConfigGet({ projectRoot }, 'project_name').envelope.data.value).toBeNull();
    });

    test('still accepts unknown keys leniently', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-cfg-'));
      const r = handleConfigSet({ projectRoot }, 'team_convention', 'we test on Pixel 7');
      expect(r.exitKind).toBe('ok');
      expect(handleConfigGet({ projectRoot }, 'team_convention').envelope.data.value).toBe(
        'we test on Pixel 7'
      );
    });

    test('a rejected set against an EXISTING config leaves the file byte-identical (Minor 7)', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-cfg-'));
      fs.mkdirSync(path.join(projectRoot, 'mobile-automator'), { recursive: true });
      const configPath = path.join(projectRoot, 'mobile-automator', 'config.json');
      const before = JSON.stringify({ project_name: 'Demo', mode: 'platform-aware' });
      fs.writeFileSync(configPath, before);
      const r = handleConfigSet({ projectRoot }, 'mode', 'windows');
      expect(r.exitKind).toBe('invalid_input');
      // coerce -> validate -> early return; configManager.set is the only
      // writer, so the file on disk must not have moved at all — not even a
      // healing rewrite (load() heals on every read, this call never reads).
      expect(fs.readFileSync(configPath, 'utf8')).toBe(before);
    });

    test('an unrelated pre-existing bad value does not block a valid write', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-cfg-'));
      fs.mkdirSync(path.join(projectRoot, 'mobile-automator'), { recursive: true });
      fs.writeFileSync(
        path.join(projectRoot, 'mobile-automator', 'config.json'),
        JSON.stringify({ platform_details: 42 })
      );
      const r = handleConfigSet({ projectRoot }, 'project_name', 'Demo');
      expect(r.exitKind).toBe('ok');
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

    test('returns raw JSON for config', () => {
      const r = handleSchema({}, 'config');
      expect(r.exitKind).toBe('ok');
      expect(r.envelope).toBeUndefined();
      const parsed = JSON.parse(r.raw);
      expect(parsed.title).toMatch(/Config/i);
      expect(parsed.properties.environments).toBeDefined();
    });

    test('unknown schema name lists config among the valid names', () => {
      const r = handleSchema({}, 'bogus');
      expect(r.exitKind).toBe('invalid_input');
      expect(r.envelope.hint).toMatch(/config/);
    });

    test('the config set rejection hint points at a command that works', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-cfg-'));
      const rejected = handleConfigSet({ projectRoot }, 'mode', 'windows');
      expect(rejected.envelope.hint).toMatch(/mauto schema config/);
      // The command that hint names must actually succeed.
      expect(handleSchema({}, 'config').exitKind).toBe('ok');
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

  // --- Issue #91: session lifecycle handlers (injected deps, no real spawn) -
  describe('handleSessionStart', () => {
    const projectRoot = '/tmp/proj91';

    test('spawns a daemon and returns started:true', async () => {
      let spawned = null;
      const spawn = { spawnDaemon: async (a) => { spawned = a; return true; } };
      const client = { isAlive: async () => false };
      const { envelope, exitKind } = await handleSessionStart(
        { projectRoot, spawn, client },
        { device: 'A', idle: '1000' }
      );
      expect(exitKind).toBe('ok');
      expect(envelope.data).toEqual({ started: true, device: 'A' });
      expect(spawned.device).toBe('A');
      expect(spawned.idleMs).toBe(1000);
    });

    test('is idempotent when a daemon is already running', async () => {
      const spawn = { spawnDaemon: async () => { throw new Error('should not spawn'); } };
      const client = { isAlive: async () => true };
      const { envelope, exitKind } = await handleSessionStart({ projectRoot, spawn, client }, {});
      expect(exitKind).toBe('ok');
      expect(envelope.data.already_running).toBe(true);
      expect(envelope.data.started).toBe(false);
    });

    test('returns a device error when spawn fails', async () => {
      const spawn = { spawnDaemon: async () => false };
      const client = { isAlive: async () => false };
      const { envelope, exitKind } = await handleSessionStart({ projectRoot, spawn, client }, {});
      expect(exitKind).toBe('device');
      expect(envelope.ok).toBe(false);
      expect(envelope.error.kind).toBe('device');
    });

    // #163: the daemon's crash is now on disk; the failure envelope has to say
    // where, or the capture is unreachable for anyone who didn't read the code.
    test('the spawn-failure hint names the daemon log path and keeps the one-shot advice', async () => {
      const spawn = { spawnDaemon: async () => false };
      const client = { isAlive: async () => false };
      const { envelope } = await handleSessionStart({ projectRoot, spawn, client }, {});
      expect(envelope.hint).toContain(sessionPaths.logFilePath(projectRoot));
      expect(envelope.hint).toContain('fall back to one-shot');
    });

    test('rejects an invalid --idle value', async () => {
      const spawn = { spawnDaemon: async () => true };
      const client = { isAlive: async () => false };
      const { envelope, exitKind } = await handleSessionStart(
        { projectRoot, spawn, client },
        { idle: 'soon' }
      );
      expect(exitKind).toBe('invalid_input');
      expect(envelope.error.kind).toBe('invalid_input');
    });

    test('fails with a device error when a live daemon is pinned to a different device', async () => {
      const spawn = { spawnDaemon: async () => { throw new Error('should not spawn'); } };
      const client = { isAlive: async () => true };
      const readHandle = () => 'A';
      const { envelope, exitKind } = await handleSessionStart(
        { projectRoot, spawn, client, readHandle },
        { device: 'B' }
      );
      expect(exitKind).toBe('device');
      expect(envelope.ok).toBe(false);
      expect(envelope.error.kind).toBe('device');
      expect(envelope.error.message).toContain('pinned to A');
      expect(envelope.error.message).toContain('not B');
      expect(envelope.hint).toContain('session end');
      expect(envelope.data).toEqual({ started: false, already_running: true, pinned: 'A', requested: 'B' });
    });

    test('reuses a live daemon when the requested device matches the handle pin', async () => {
      const spawn = { spawnDaemon: async () => { throw new Error('should not spawn'); } };
      const client = { isAlive: async () => true };
      const readHandle = () => 'A';
      const { envelope, exitKind } = await handleSessionStart(
        { projectRoot, spawn, client, readHandle },
        { device: 'A' }
      );
      expect(exitKind).toBe('ok');
      expect(envelope.data.already_running).toBe(true);
      expect(envelope.data.device).toBe('A');
    });

    test('fails when a live daemon is unpinned and a specific device is requested', async () => {
      const spawn = { spawnDaemon: async () => { throw new Error('should not spawn'); } };
      const client = { isAlive: async () => true };
      const readHandle = () => null;
      const { envelope, exitKind } = await handleSessionStart(
        { projectRoot, spawn, client, readHandle },
        { device: 'B' }
      );
      expect(exitKind).toBe('device');
      expect(envelope.ok).toBe(false);
      expect(envelope.error.message).toContain('auto');
      expect(envelope.hint).toContain('session end');
    });

    test('reuses a live daemon when no device is requested, whatever its pin', async () => {
      const spawn = { spawnDaemon: async () => { throw new Error('should not spawn'); } };
      const client = { isAlive: async () => true };
      const readHandle = () => 'A';
      const { envelope, exitKind } = await handleSessionStart(
        { projectRoot, spawn, client, readHandle },
        {}
      );
      expect(exitKind).toBe('ok');
      expect(envelope.data.already_running).toBe(true);
      expect(envelope.data.device).toBeNull();
    });
  });

  describe('handleSessionStatus', () => {
    test('reports running:true with in_flight and device from the client', async () => {
      const up = await handleSessionStatus({
        projectRoot: '/x',
        client: { getSessionStatus: async () => ({ running: true, in_flight: 2, device: 'A' }) },
      });
      expect(up.exitKind).toBe('ok');
      expect(up.envelope.data).toEqual({
        running: true, in_flight: 2, device: 'A',
        log_path: sessionPaths.logFilePath('/x'), session_id: null,
      });
    });

    test('reports running:false with null in_flight/device when no daemon is up', async () => {
      const down = await handleSessionStatus({
        projectRoot: '/x',
        client: { getSessionStatus: async () => ({ running: false, in_flight: null, device: null }) },
      });
      expect(down.exitKind).toBe('ok');
      // log_path survives the not-running shape: that is when it is needed.
      expect(down.envelope.data).toEqual({
        running: false, in_flight: null, device: null,
        log_path: sessionPaths.logFilePath('/x'), session_id: null,
      });
    });
  });

  describe('handleSessionEnd', () => {
    test('stopped:true when a daemon acknowledged shutdown', async () => {
      const r = await handleSessionEnd({ projectRoot: '/x', client: { requestShutdown: async () => true } });
      expect(r.exitKind).toBe('ok');
      expect(r.envelope.data.stopped).toBe(true);
      expect(r.envelope.data.already_stopped).toBe(false);
    });

    test('already_stopped:true when no daemon was reachable', async () => {
      const r = await handleSessionEnd({ projectRoot: '/x', client: { requestShutdown: async () => false } });
      expect(r.envelope.data.stopped).toBe(false);
      expect(r.envelope.data.already_stopped).toBe(true);
    });
  });

  describe('handleDevices', () => {
    test('returns ok envelope with the normalized device list', async () => {
      const deviceBridge = {
        listDevices: async () => [
          { id: 'emulator-5554', name: 'Pixel', platform: 'android', state: 'running' },
        ],
      };
      const { envelope, exitKind } = await handleDevices({ deviceBridge });
      expect(exitKind).toBe('ok');
      expect(envelope.ok).toBe(true);
      expect(envelope.data).toHaveLength(1);
      expect(JSON.stringify(envelope)).not.toMatch(/resource_id/);
    });

    test('an empty device list is ok([]) with exit 0', async () => {
      const deviceBridge = { listDevices: async () => [] };
      const { envelope, exitKind } = await handleDevices({ deviceBridge });
      expect(exitKind).toBe('ok');
      expect(envelope.ok).toBe(true);
      expect(envelope.data).toEqual([]);
    });

    test('a bridge error -> device fail (exit 2)', async () => {
      const deviceBridge = {
        listDevices: async () => {
          throw new Error('mobile-mcp unreachable');
        },
      };
      const { envelope, exitKind } = await handleDevices({ deviceBridge });
      expect(exitKind).toBe('device');
      expect(envelope.ok).toBe(false);
      expect(envelope.error.kind).toBe('device');
      expect(envelope.error.message).toMatch(/unreachable/);
    });
  });

  describe('handleDevicesUse', () => {
    test('persists a valid id via the injected store and returns the device', async () => {
      const writes = [];
      const store = { write: (root, id) => writes.push([root, id]) };
      const deviceBridge = {
        listDevices: async () => [
          { id: 'A', name: 'Phone A', platform: 'android', state: 'running' },
          { id: 'B', name: 'Phone B', platform: 'ios', state: 'booted' },
        ],
      };
      const { envelope, exitKind } = await handleDevicesUse(
        { deviceBridge, store, projectRoot: '/x' },
        'B'
      );
      expect(exitKind).toBe('ok');
      expect(envelope.data.selected).toBe('B');
      expect(writes).toEqual([['/x', 'B']]);
    });

    test('zero devices -> device fail with a hint (exit 2), store not written', async () => {
      const writes = [];
      const store = { write: (...a) => writes.push(a) };
      const deviceBridge = { listDevices: async () => [] };
      const { envelope, exitKind } = await handleDevicesUse(
        { deviceBridge, store, projectRoot: '/x' },
        'A'
      );
      expect(exitKind).toBe('device');
      expect(envelope.ok).toBe(false);
      expect(envelope.hint).toBeTruthy();
      expect(writes).toEqual([]);
    });

    test('unknown id (ambiguous/no match) -> device fail with a hint, store not written', async () => {
      const writes = [];
      const store = { write: (...a) => writes.push(a) };
      const deviceBridge = {
        listDevices: async () => [
          { id: 'A', name: null, platform: null, state: null },
          { id: 'B', name: null, platform: null, state: null },
        ],
      };
      const { envelope, exitKind } = await handleDevicesUse(
        { deviceBridge, store, projectRoot: '/x' },
        'C'
      );
      expect(exitKind).toBe('device');
      expect(envelope.error.kind).toBe('device');
      expect(envelope.hint).toMatch(/A, B/);
      expect(writes).toEqual([]);
    });

    test('missing id -> invalid_input', async () => {
      const deviceBridge = { listDevices: async () => [{ id: 'A' }] };
      const { exitKind } = await handleDevicesUse(
        { deviceBridge, store: {}, projectRoot: '/x' },
        ''
      );
      expect(exitKind).toBe('invalid_input');
    });
  });

  describe('handleDevicesClear', () => {
    test('clears via the injected store and reports the previous selection', async () => {
      const cleared = [];
      const store = { read: () => 'A', clear: (root) => cleared.push(root) };
      const { envelope, exitKind } = await handleDevicesClear({
        store,
        projectRoot: '/x',
        isAlive: async () => false,
      });
      expect(exitKind).toBe('ok');
      expect(envelope.data.cleared).toBe('A');
      expect(cleared).toEqual(['/x']);
    });

    test('reports cleared:null when nothing was selected', async () => {
      const store = { read: () => null, clear: () => {} };
      const { envelope } = await handleDevicesClear({
        store,
        projectRoot: '/x',
        isAlive: async () => false,
      });
      expect(envelope.data.cleared).toBeNull();
    });

    test('surfaces daemon_still_pinned when a live daemon stays pinned after the clear', async () => {
      const store = { read: () => 'B', clear: () => {} };
      const { envelope, exitKind } = await handleDevicesClear({
        store,
        projectRoot: '/x',
        isAlive: async () => true,
        readHandle: () => 'A',
      });
      expect(exitKind).toBe('ok');
      expect(envelope.ok).toBe(true);
      expect(envelope.data.cleared).toBe('B');
      expect(envelope.data.daemon_still_pinned).toBe('A');
      expect(envelope.hint).toContain('session end');
    });

    test('reports daemon_still_pinned:null for a live unpinned daemon', async () => {
      const store = { read: () => null, clear: () => {} };
      const { envelope } = await handleDevicesClear({
        store,
        projectRoot: '/x',
        isAlive: async () => true,
        readHandle: () => null,
      });
      expect(envelope.data.cleared).toBeNull();
      expect(envelope.data.daemon_still_pinned).toBeNull();
    });

    test('omits daemon_still_pinned when no daemon is running', async () => {
      const store = { read: () => 'A', clear: () => {} };
      const { envelope } = await handleDevicesClear({
        store,
        projectRoot: '/x',
        isAlive: async () => false,
      });
      expect(envelope.data.cleared).toBe('A');
      expect('daemon_still_pinned' in envelope.data).toBe(false);
    });
  });

  // Verb-level wiring: --device override vs persisted selection precedence.
  describe('device verb selection precedence (buildProgram)', () => {
    function tmpRoot() {
      return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-devsel-'));
    }

    // Run `argv` through a program with an injected bridge factory that records
    // the device it was asked for, and an injected emit that swallows output.
    async function runVerb(argv, projectRoot) {
      const seen = [];
      const deviceBridgeFactory = async ({ device }) => {
        seen.push(device);
        return {
          bridge: {
            listElements: async () => [],
            tap: async () => ({}),
          },
          close: async () => {},
        };
      };
      const program = buildProgram({
        projectRoot,
        deviceBridgeFactory,
        emit: () => {},
      });
      await program.parseAsync(['node', 'mauto', ...argv]);
      return seen;
    }

    test('--device on a verb overrides the persisted selection', async () => {
      const root = tmpRoot();
      selectionStore.write(root, 'persisted-id');
      const seen = await runVerb(['elements', '--device', 'flag-id'], root);
      expect(seen).toEqual(['flag-id']);
    });

    test('a verb with no flag uses the persisted selection', async () => {
      const root = tmpRoot();
      selectionStore.write(root, 'persisted-id');
      const seen = await runVerb(['elements'], root);
      expect(seen).toEqual(['persisted-id']);
    });

    test('a verb with no flag and no selection passes null (fast path)', async () => {
      const root = tmpRoot();
      const seen = await runVerb(['elements'], root);
      expect(seen).toEqual([null]);
    });

    test('an action verb (tap) also honors the persisted selection', async () => {
      const root = tmpRoot();
      selectionStore.write(root, 'persisted-id');
      const seen = await runVerb(['tap', '--at', '1,2'], root);
      expect(seen).toEqual(['persisted-id']);
    });
  });

  describe('handleInit — five agents + all', () => {
    const fsForInit = fs;
    const pathForInit = path;
    function initTmpRoot() {
      return fsForInit.mkdtempSync(pathForInit.join(os.tmpdir(), 'mauto-cliinit-'));
    }

    test('unknown agent fails with a hint listing all five', () => {
      const r = handleInit({ projectRoot: initTmpRoot() }, 'frobnicator');
      expect(r.exitKind).toBe('invalid_input');
      expect(r.envelope.hint).toMatch(/claude.*cursor.*gemini.*copilot.*agents/);
    });

    test('a single agent installs its skills', () => {
      const projectRoot = initTmpRoot();
      const r = handleInit({ projectRoot }, 'gemini');
      expect(r.exitKind).toBe('ok');
      const f = pathForInit.join(projectRoot, '.gemini', 'skills', 'mobile-automator-execute', 'SKILL.md');
      expect(fsForInit.existsSync(f)).toBe(true);
    });

    test('all installs skills for every agent', () => {
      const projectRoot = initTmpRoot();
      const r = handleInit({ projectRoot }, 'all');
      expect(r.exitKind).toBe('ok');
      // data.agents is now a per-agent ok/failed map.
      expect(r.envelope.data.agents.map((a) => a.agent).sort()).toEqual(
        ['agents', 'claude', 'copilot', 'cursor', 'gemini']
      );
      expect(r.envelope.data.agents.every((a) => a.ok === true)).toBe(true);
      for (const [agent, dir] of [
        ['claude', '.claude/skills'],
        ['cursor', '.cursor/skills'],
        ['gemini', '.gemini/skills'],
        ['copilot', '.github/skills'],
        ['agents', '.agents/skills'],
      ]) {
        const f = pathForInit.join(projectRoot, dir, 'mobile-automator-generate', 'SKILL.md');
        expect(fsForInit.existsSync(f)).toBe(true);
      }
    });

    // --- Issue #121: --agent all is atomic-honest (continue-on-error + map) --
    test('all: one adapter throwing yields a non-ok partial_failure envelope, NOT a thrown stack trace', () => {
      const projectRoot = initTmpRoot();
      const { ADAPTERS } = require('../../src/init/adapters');
      const boom = new Error('EACCES: permission denied');
      boom.code = 'EACCES';
      const adapters = {
        ...ADAPTERS,
        copilot: { apply() { throw boom; } },
      };

      let r;
      expect(() => {
        r = handleInit({ projectRoot, adapters }, 'all');
      }).not.toThrow();

      expect(r.exitKind).not.toBe('ok');
      expect(r.envelope.ok).toBe(false);
      expect(r.envelope.error.kind).toBe('partial_failure');
      // Per-agent map present and honest.
      const byAgent = Object.fromEntries(r.envelope.data.agents.map((a) => [a.agent, a]));
      expect(byAgent.copilot.ok).toBe(false);
      expect(byAgent.copilot.error).toBe('EACCES');
      expect(byAgent.claude.ok).toBe(true);
    });

    test('all: the OTHER agents are still written even when one throws (continue-on-error)', () => {
      const projectRoot = initTmpRoot();
      const { ADAPTERS } = require('../../src/init/adapters');
      const adapters = {
        ...ADAPTERS,
        copilot: { apply() { throw new Error('nope'); } },
      };
      handleInit({ projectRoot, adapters }, 'all');
      // claude, cursor, gemini, agents all succeeded and left files on disk.
      for (const dir of ['.claude/skills', '.cursor/skills', '.gemini/skills', '.agents/skills']) {
        const f = pathForInit.join(projectRoot, dir, 'mobile-automator-generate', 'SKILL.md');
        expect(fsForInit.existsSync(f)).toBe(true);
      }
    });

    test('all: a corrupt pre-existing .mcp.json fails claude honestly without a raw throw, others still written', () => {
      const projectRoot = initTmpRoot();
      // claude merges .mcp.json; seed it with invalid JSON.
      fsForInit.writeFileSync(pathForInit.join(projectRoot, '.mcp.json'), '{ not json');

      let r;
      expect(() => {
        r = handleInit({ projectRoot }, 'all');
      }).not.toThrow();

      expect(r.envelope.ok).toBe(false);
      expect(r.envelope.error.kind).toBe('partial_failure');
      const byAgent = Object.fromEntries(r.envelope.data.agents.map((a) => [a.agent, a]));
      expect(byAgent.claude.ok).toBe(false);
      expect(byAgent.claude.error).toBe('corrupt_mcp_config');
      // The corrupt file is left untouched (never clobbered).
      expect(fsForInit.readFileSync(pathForInit.join(projectRoot, '.mcp.json'), 'utf8')).toBe('{ not json');
      // gemini/agents have no merge step and still get their skills.
      expect(
        fsForInit.existsSync(pathForInit.join(projectRoot, '.gemini/skills', 'mobile-automator-generate', 'SKILL.md'))
      ).toBe(true);
    });

    test('single agent: a throwing apply yields a fail envelope, never a raw stack trace', () => {
      const projectRoot = initTmpRoot();
      fsForInit.writeFileSync(pathForInit.join(projectRoot, '.mcp.json'), 'totally-not-json');
      let r;
      expect(() => {
        r = handleInit({ projectRoot }, 'claude');
      }).not.toThrow();
      expect(r.envelope.ok).toBe(false);
      expect(r.exitKind).not.toBe('ok');
    });

    // --- Honest error classification (PR #125 review): a codeless throw (a
    // real CLI bug) must NOT be disguised as a filesystem fault. ---
    test('all: a codeless (non-fs) adapter error is classified internal, never io_error', () => {
      const projectRoot = initTmpRoot();
      const { ADAPTERS } = require('../../src/init/adapters');
      const adapters = {
        ...ADAPTERS,
        copilot: { apply() { throw new TypeError('cannot read properties of undefined'); } },
      };
      const r = handleInit({ projectRoot, adapters }, 'all');
      const byAgent = Object.fromEntries(r.envelope.data.agents.map((a) => [a.agent, a]));
      expect(byAgent.copilot.ok).toBe(false);
      expect(byAgent.copilot.error).toBe('internal');
      expect(byAgent.copilot.error).not.toBe('io_error');
    });

    test('single agent: a codeless error does not blame the filesystem in its hint', () => {
      const projectRoot = initTmpRoot();
      const boom = new Error('skill generate leaked a placeholder token'); // no .code
      const adapters = { claude: { apply() { throw boom; } } };
      const r = handleInit({ projectRoot, adapters }, 'claude');
      expect(r.envelope.ok).toBe(false);
      expect(r.envelope.data.agents[0].error).toBe('internal');
      expect(r.envelope.hint).not.toMatch(/filesystem/i);
    });

    test('all: a real filesystem errno keeps its E-code class + a filesystem hint', () => {
      const projectRoot = initTmpRoot();
      const { ADAPTERS } = require('../../src/init/adapters');
      const boom = new Error('EACCES: permission denied'); boom.code = 'EACCES';
      const adapters = { ...ADAPTERS, copilot: { apply() { throw boom; } } };
      const r = handleInit({ projectRoot, adapters }, 'all');
      const byAgent = Object.fromEntries(r.envelope.data.agents.map((a) => [a.agent, a]));
      expect(byAgent.copilot.error).toBe('EACCES');
    });
  });

  // --- Fix-wave FIX 1: argv -> action body -> handler -> store wiring ------
  //
  // The unit tests above call the HANDLERS directly, which proves the handler
  // passes its argument to the store — but proves nothing about whether
  // commander's parsed `opts.*` actually reaches the handler at all. A deleted
  // `deviceModel: opts.deviceModel,` line in the finalize action body left the
  // rest of the suite green. These tests close that gap by building a REAL
  // program (`buildProgram`) and parsing REAL argv (`program.parseAsync`),
  // then asserting the values the injected store received — one test per
  // `result` verb, covering every flag it accepts (including a REPEATED
  // --observation and --capture, which also exercises commander's `collect`
  // reducer with an actual repetition for the first time).
  describe('result verb argv wiring (buildProgram parses real argv)', () => {
    function tmpRoot() {
      return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-resultargv-'));
    }

    // A store double that records every call it receives, standing in for
    // ResultStore so these tests assert on what reached the STORE layer, not
    // the filesystem.
    function fakeStore() {
      const calls = { addStep: [], addObservation: [], captureVariable: [], addAssertion: [], finalize: [] };
      const store = {
        warnings: [],
        addStep(arg) {
          calls.addStep.push(arg);
          return { step_id: arg.step_id, status: arg.status };
        },
        addObservation(arg) {
          calls.addObservation.push(arg);
          return { ...arg };
        },
        captureVariable(name, value) {
          calls.captureVariable.push({ name, value });
        },
        addAssertion(arg) {
          calls.addAssertion.push(arg);
          return { ...arg };
        },
        finalize(arg) {
          calls.finalize.push(arg);
          return { run_id: 'stub', ...arg };
        },
      };
      return { store, calls };
    }

    // A memory store double so `result finalize`'s best-effort auto-harvest
    // never touches the real MemoryStore/filesystem in these argv tests.
    function fakeMemoryStore() {
      return { warnings: [], recordRun() {} };
    }

    async function runVerb(argv, deps) {
      const program = buildProgram({ projectRoot: tmpRoot(), emit: () => {}, ...deps });
      await program.parseAsync(['node', 'mauto', ...argv]);
    }

    test('add-step: every flag reaches the store, including a REPEATED --observation and --capture', async () => {
      const { store, calls } = fakeStore();
      const factoryArgs = [];
      const resultStoreFactory = (args) => { factoryArgs.push(args); return store; };

      await runVerb(
        [
          'result', 'add-step',
          '--run-id', 'run_argv_1',
          '--scenario-id', 'scn_argv',
          '--step-id', 'step_1',
          '--status', 'fail',
          '--attempts', '3',
          '--screenshot', 'mobile-automator/screenshots/step_1.png',
          '--error-message', 'button not found',
          '--observation', 'regression:logo is gone',
          '--observation', 'state_context:dark mode was active',
          '--capture', 'order_id=A-1729',
          '--capture', 'user_name=jane',
        ],
        { resultStoreFactory }
      );

      // The store factory itself received run-id/scenario-id.
      expect(factoryArgs[0]).toMatchObject({ runId: 'run_argv_1', scenarioId: 'scn_argv' });

      // Every scalar add-step flag landed on the store.addStep call.
      expect(calls.addStep).toEqual([
        {
          step_id: 'step_1',
          status: 'fail',
          attempts: 3,
          screenshot: 'mobile-automator/screenshots/step_1.png',
          error_message: 'button not found',
        },
      ]);

      // BOTH repeated --observation values reached the store, in order —
      // proving commander's `collect` reducer actually accumulated them.
      expect(calls.addObservation).toEqual([
        { type: 'regression', message: 'logo is gone', step_id: 'step_1' },
        { type: 'state_context', message: 'dark mode was active', step_id: 'step_1' },
      ]);

      // BOTH repeated --capture values reached the store, in order.
      expect(calls.captureVariable).toEqual([
        { name: 'order_id', value: 'A-1729' },
        { name: 'user_name', value: 'jane' },
      ]);
    });

    test('add-assertion: every flag reaches the store', async () => {
      const { store, calls } = fakeStore();
      const factoryArgs = [];
      const resultStoreFactory = (args) => { factoryArgs.push(args); return store; };

      await runVerb(
        [
          'result', 'add-assertion',
          '--run-id', 'run_argv_2',
          '--scenario-id', 'scn_argv_2',
          '--step-id', 'step_verify',
          '--type', 'element_exists',
          '--pass', 'false',
          '--assertion-id', 'assert_custom_id',
          '--message', 'Login button missing',
          '--expected', 'visible',
          '--actual', 'absent',
        ],
        { resultStoreFactory }
      );

      expect(factoryArgs[0]).toMatchObject({ runId: 'run_argv_2', scenarioId: 'scn_argv_2' });
      expect(calls.addAssertion).toEqual([
        {
          step_id: 'step_verify',
          assertion_id: 'assert_custom_id',
          type: 'element_exists',
          pass: false,
          message: 'Login button missing',
          expected: 'visible',
          actual: 'absent',
        },
      ]);
    });

    test('finalize: every flag reaches the store', async () => {
      const { store, calls } = fakeStore();
      const factoryArgs = [];
      const resultStoreFactory = (args) => { factoryArgs.push(args); return store; };
      const memoryStoreFactory = () => fakeMemoryStore();

      await runVerb(
        [
          'result', 'finalize',
          '--run-id', 'run_argv_3',
          '--scenario-id', 'scn_argv_3',
          '--status', 'passed',
          '--duration', '12',
          '--app-version', '2.3.4',
          '--device-model', 'Pixel 7',
          '--api-level', '34',
          '--environment', 'staging',
          '--summary', 'Custom narrative summary.',
        ],
        { resultStoreFactory, memoryStoreFactory }
      );

      expect(factoryArgs[0]).toMatchObject({ runId: 'run_argv_3', scenarioId: 'scn_argv_3' });
      expect(calls.finalize).toEqual([
        {
          status: 'passed',
          durationSeconds: 12,
          metadata: {
            app_version: '2.3.4',
            device_model: 'Pixel 7',
            api_level: '34',
            environment: 'staging',
          },
          summary: 'Custom narrative summary.',
        },
      ]);
    });
  });
});
