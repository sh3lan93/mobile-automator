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

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      let a;
      try {
        a = handleResultAddStep(deps, { runId, stepId: 'launch', status: 'pass' });
      } finally {
        warnSpy.mockRestore();
      }
      expect(a.exitKind).toBe('ok');
      expect(a.envelope.ok).toBe(true);
      expect(a.envelope.hint).toMatch(/corrupt/i);
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
  });

  describe('handleSessionStatus', () => {
    test('reports running:true/false from the client', async () => {
      const up = await handleSessionStatus({ projectRoot: '/x', client: { isAlive: async () => true } });
      expect(up.exitKind).toBe('ok');
      expect(up.envelope.data.running).toBe(true);
      const down = await handleSessionStatus({ projectRoot: '/x', client: { isAlive: async () => false } });
      expect(down.envelope.data.running).toBe(false);
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
    test('clears via the injected store and reports the previous selection', () => {
      const cleared = [];
      const store = { read: () => 'A', clear: (root) => cleared.push(root) };
      const { envelope, exitKind } = handleDevicesClear({ store, projectRoot: '/x' });
      expect(exitKind).toBe('ok');
      expect(envelope.data.cleared).toBe('A');
      expect(cleared).toEqual(['/x']);
    });

    test('reports cleared:null when nothing was selected', () => {
      const store = { read: () => null, clear: () => {} };
      const { envelope } = handleDevicesClear({ store, projectRoot: '/x' });
      expect(envelope.data.cleared).toBeNull();
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
      expect(r.envelope.data.agents.sort()).toEqual(
        ['agents', 'claude', 'copilot', 'cursor', 'gemini']
      );
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
  });
});
