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
  handleTerminate,
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
  handleTelemetryStatus,
  handleTelemetryEnable,
  handleTelemetryDisable,
  handleTelemetryFlush,
  buildProgram,
} = require('../../src/cli');
const selectionStore = require('../../src/device/selection');
const sessionPaths = require('../../src/device/session-paths');
const { createCliAjv } = require('../../src/schemas/cli-ajv');

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

    test('an unparseable element list becomes an ok:false device envelope, not a crash', async () => {
      const { DeviceBridge } = require('../../src/device/bridge');
      const deviceBridge = new DeviceBridge({
        call: async () => 'One element per line: @ref Type [focused] [disabled]\n@e1 Button text="Login"',
      });
      const { envelope, exitKind } = await handleElements({ deviceBridge });
      expect(exitKind).toBe('device');
      expect(envelope.ok).toBe(false);
      expect(envelope.error.kind).toBe('device');
      expect(envelope.error.message).toMatch(/element list could not be parsed/i);
      expect(envelope.hint).toMatch(/output format/i);
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

    // #214: the daemon's cwd is not the caller's, so a relative path is
    // resolved here, against the directory the verb was run from.
    test('resolves a relative path against the caller cwd', async () => {
      const calls = [];
      const fakeBridge = { screenshot: async (p) => { calls.push(p); return p; } };
      const { envelope, exitKind } = await handleScreenshot(
        { deviceBridge: fakeBridge, cwd: '/work/sub' },
        'shots/home.png'
      );
      expect(exitKind).toBe('ok');
      expect(calls).toEqual(['/work/sub/shots/home.png']);
      expect(envelope.data).toEqual({ path: '/work/sub/shots/home.png' });
    });

    test('passes an absolute path through unchanged', async () => {
      const calls = [];
      const fakeBridge = { screenshot: async (p) => { calls.push(p); return p; } };
      await handleScreenshot({ deviceBridge: fakeBridge, cwd: '/work/sub' }, '/tmp/shot.png');
      expect(calls).toEqual(['/tmp/shot.png']);
    });

    test('normalizes .. segments', async () => {
      const calls = [];
      const fakeBridge = { screenshot: async (p) => { calls.push(p); return p; } };
      await handleScreenshot({ deviceBridge: fakeBridge, cwd: '/work/sub' }, '../x.png');
      expect(calls).toEqual(['/work/x.png']);
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

    describe('unsupported actions (#166)', () => {
      const unsupportedScenario = () => {
        const s = validScenario();
        s.steps.push({ id: 'wipe', action: 'clear_app_data', target_package: 'com.example.app', description: 'Clear' });
        return s;
      };
      const run = (scenario, opts) => {
        const file = writeTmp('u.json', JSON.stringify(scenario));
        const validator = new ScenarioValidator({ schemaPath: SCHEMA_PATH });
        return handleValidate({ validator }, file, opts);
      };

      test('clean scenario -> no warnings key, no hint', () => {
        const { envelope } = run(validScenario());
        expect(envelope.data).toEqual({ valid: true });
        expect(envelope).not.toHaveProperty('hint');
      });

      test('unsupported action -> ok with warnings and a hint', () => {
        const { envelope, exitKind } = run(unsupportedScenario());
        expect(exitKind).toBe('ok');
        expect(envelope.ok).toBe(true);
        expect(envelope.data.valid).toBe(true);
        expect(envelope.data.warnings).toHaveLength(1);
        expect(envelope.data.warnings[0]).toMatchObject({
          code: 'unsupported_action',
          action: 'clear_app_data',
          path: 'steps[1]',
          step_id: 'wipe',
        });
        expect(envelope.hint).toBe('1 action(s) cannot replay unattended — see data.warnings');
      });

      test('--strict + unsupported -> invalid_input failure carrying warnings', () => {
        const { envelope, exitKind } = run(unsupportedScenario(), { strict: true });
        expect(exitKind).toBe('invalid_input');
        expect(envelope.ok).toBe(false);
        expect(envelope.error.kind).toBe('invalid_input');
        expect(envelope.data.valid).toBe(false);
        expect(envelope.data.errors).toEqual([]);
        expect(envelope.data.warnings).toHaveLength(1);
      });

      test('--strict + unsupported action only inside sub_steps -> invalid_input', () => {
        const s = validScenario();
        s.steps.push({
          id: 'branch',
          action: 'tap',
          target: 'Branch',
          description: 'Branch',
          sub_steps: [{ id: 'nested_wipe', action: 'clear_app_data', target_package: 'com.example.app', description: 'Clear' }],
        });
        const { envelope, exitKind } = run(s, { strict: true });
        expect(exitKind).toBe('invalid_input');
        expect(envelope.data.valid).toBe(false);
        expect(envelope.data.warnings).toHaveLength(1);
        expect(envelope.data.warnings[0]).toMatchObject({
          action: 'clear_app_data',
          path: `steps[${s.steps.length - 1}].sub_steps[0]`,
          step_id: 'nested_wipe',
        });
      });

      test('--strict + clean scenario -> ok', () => {
        const { envelope, exitKind } = run(validScenario(), { strict: true });
        expect(exitKind).toBe('ok');
        expect(envelope.data).toEqual({ valid: true });
      });
    });

    describe('mid-flow launch relying on the cold default (#255)', () => {
      const ADVISORY_HINT = '1 step(s) leave an optional field unset; set it explicitly — see data.warnings';
      const midLaunch = (s) => {
        s.steps.push({ id: 'back_to_app', action: 'launch_app', description: 'Return to the app' });
        return s;
      };
      const run = (scenario, opts) => {
        const file = writeTmp('l.json', JSON.stringify(scenario));
        const validator = new ScenarioValidator({ schemaPath: SCHEMA_PATH });
        return handleValidate({ validator }, file, opts);
      };

      test('advisory only -> ok with the warning and an advisory hint', () => {
        const { envelope, exitKind } = run(midLaunch(validScenario()));
        expect(exitKind).toBe('ok');
        expect(envelope.data.valid).toBe(true);
        expect(envelope.data.warnings).toHaveLength(1);
        expect(envelope.data.warnings[0]).toMatchObject({
          code: 'launch_cold_implicit', path: 'steps[1]', step_id: 'back_to_app',
        });
        expect(envelope.hint).toBe(ADVISORY_HINT);
      });

      test('--strict + advisory only -> still ok', () => {
        const { envelope, exitKind } = run(midLaunch(validScenario()), { strict: true });
        expect(exitKind).toBe('ok');
        expect(envelope.ok).toBe(true);
        expect(envelope.data.warnings).toHaveLength(1);
        expect(envelope.hint).toBe(ADVISORY_HINT);
      });

      test('--strict + unsupported + advisory -> invalid_input carrying both warnings', () => {
        const s = midLaunch(validScenario());
        s.steps.push({ id: 'wipe', action: 'clear_app_data', target_package: 'com.example.app', description: 'Clear' });
        const { envelope, exitKind } = run(s, { strict: true });
        expect(exitKind).toBe('invalid_input');
        expect(envelope.data.valid).toBe(false);
        expect(envelope.data.warnings.map((w) => w.code)).toEqual(['launch_cold_implicit', 'unsupported_action']);
        expect(envelope.hint).toBe(
          `1 action(s) cannot replay unattended — see data.warnings; ${ADVISORY_HINT}`
        );
      });
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

    // mobile-mcp 1.0.5 declares coordinates .min(0); a negative would come back
    // as a device-side validation error and trigger the crash probe (#199).
    test.each(['-1,20', '10,-5', '-3,-4', '-0.6,10'])('rejects negative coordinates "%s" before the device', async (raw) => {
      const bridge = { tap: async () => { throw new Error('should not be called'); } };
      const { envelope, exitKind } = await handleTap({ deviceBridge: bridge }, raw);
      expect(exitKind).toBe('invalid_input');
      expect(envelope.error.kind).toBe('invalid_input');
      expect(envelope.error.message).toMatch(/non-negative|>= 0/);
      expect(envelope.error.message).toContain(raw);
      expect(envelope.hint).toMatch(/>= 0/);
    });

    test('accepts 0 and a tiny negative that rounds to 0 (-0.4 -> 0, never -0)', async () => {
      const calls = [];
      const bridge = { tap: async (c) => { calls.push(c); } };
      const { envelope, exitKind } = await handleTap({ deviceBridge: bridge }, '-0.4,0');
      expect(exitKind).toBe('ok');
      expect(envelope.data).toEqual({ tapped: [0, 0] });
      expect(Object.is(calls[0].x, 0)).toBe(true);
    });

    test('long-press and double-tap share the negative-coordinate guard', async () => {
      const bridge = {
        longPress: async () => { throw new Error('should not be called'); },
        doubleTap: async () => { throw new Error('should not be called'); },
      };
      expect((await handleLongPress({ deviceBridge: bridge }, '-1,1')).exitKind).toBe('invalid_input');
      expect((await handleDoubleTap({ deviceBridge: bridge }, '1,-1')).exitKind).toBe('invalid_input');
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
    // The cold start itself (terminate, then launch) lives in
    // DeviceBridge#restartApp; the handler only picks the bridge method.
    function recordingBridge({ restartError, launchError } = {}) {
      const calls = [];
      return {
        calls,
        restartApp: async (a) => { calls.push(['restart', a]); if (restartError) throw restartError; },
        launchApp: async (a) => { calls.push(['launch', a]); if (launchError) throw launchError; },
        terminateApp: async (a) => { calls.push(['terminate', a]); },
      };
    }

    test('cold-starts by default through restartApp only', async () => {
      const bridge = recordingBridge();
      const { envelope, exitKind } = await handleLaunch({ deviceBridge: bridge }, 'com.example.app');
      expect(exitKind).toBe('ok');
      expect(envelope.data).toEqual({ launched: 'com.example.app', cold: true });
      expect(bridge.calls).toEqual([['restart', 'com.example.app']]);
    });

    test('resume launches only and never restarts', async () => {
      const bridge = recordingBridge();
      const { envelope, exitKind } = await handleLaunch({ deviceBridge: bridge }, 'com.example.app', { resume: true });
      expect(exitKind).toBe('ok');
      expect(envelope.data).toEqual({ launched: 'com.example.app', cold: false });
      expect(bridge.calls).toEqual([['launch', 'com.example.app']]);
    });

    test('a restartApp rejection is a device failure envelope carrying its --resume hint', async () => {
      const err = new Error('device offline');
      err.hint = 'Could not stop the app before restarting it. Pass --resume to bring it to the front without restarting.';
      const bridge = recordingBridge({ restartError: err });
      const { envelope, exitKind } = await handleLaunch({ deviceBridge: bridge }, 'com.example.app');
      expect(exitKind).toBe('device');
      expect(envelope.ok).toBe(false);
      expect(envelope.error.kind).toBe('device');
      expect(envelope.error.message).toBe('device offline');
      expect(envelope.hint).toMatch(/--resume/);
    });

    test('a restartApp rejection from the real bridge reaches the envelope with the --resume hint', async () => {
      const { DeviceBridge } = require('../../src/device/bridge');
      const calls = [];
      const deviceBridge = new DeviceBridge({
        call: async (tool) => {
          calls.push(tool);
          if (tool === 'mobile_terminate_app') throw new Error('device offline');
          return {};
        },
      });
      const { envelope, exitKind } = await handleLaunch({ deviceBridge }, 'com.example.app');
      expect(exitKind).toBe('device');
      expect(envelope.hint).toMatch(/--resume/);
      expect(calls).toEqual(['mobile_terminate_app']);
    });

    test('a launch failure is a failure envelope', async () => {
      const bridge = recordingBridge({ restartError: new Error('no such app') });
      const { envelope, exitKind } = await handleLaunch({ deviceBridge: bridge }, 'com.example.app');
      expect(exitKind).toBe('device');
      expect(envelope.ok).toBe(false);
      expect(envelope.error.kind).toBe('device');
      expect(envelope.error.message).toBe('no such app');
    });

    test('rejects a missing appId with invalid_input', async () => {
      const bridge = {
        launchApp: async () => { throw new Error('should not be called'); },
        restartApp: async () => { throw new Error('should not be called'); },
      };
      const { envelope, exitKind } = await handleLaunch({ deviceBridge: bridge }, '');
      expect(exitKind).toBe('invalid_input');
      expect(envelope.error.kind).toBe('invalid_input');
      expect(envelope.hint).toBeTruthy();
    });
  });

  describe('handleTerminate', () => {
    test('terminates an app and reports the id', async () => {
      const calls = [];
      const bridge = { terminateApp: async (a) => { calls.push(a); } };
      const { envelope, exitKind } = await handleTerminate({ deviceBridge: bridge }, 'com.example.app');
      expect(exitKind).toBe('ok');
      expect(envelope.data).toEqual({ terminated: 'com.example.app' });
      expect(calls).toEqual(['com.example.app']);
    });

    test('an engine error is a failure envelope', async () => {
      const bridge = { terminateApp: async () => { throw new Error('engine said no'); } };
      const { envelope, exitKind } = await handleTerminate({ deviceBridge: bridge }, 'com.example.app');
      expect(exitKind).toBe('device');
      expect(envelope.ok).toBe(false);
      expect(envelope.error.message).toBe('engine said no');
    });

    test('rejects a missing appId with invalid_input', async () => {
      const bridge = { terminateApp: async () => { throw new Error('should not be called'); } };
      const { envelope, exitKind } = await handleTerminate({ deviceBridge: bridge }, '');
      expect(exitKind).toBe('invalid_input');
      expect(envelope.error.kind).toBe('invalid_input');
      expect(envelope.hint).toMatch(/mauto terminate/);
    });
  });

  describe('handleInstall', () => {
    test('installs an app and reports the resolved path', async () => {
      const calls = [];
      const bridge = { installApp: async (p) => { calls.push(p); } };
      const { envelope, exitKind } = await handleInstall({ deviceBridge: bridge, cwd: '/work' }, './app.apk');
      expect(exitKind).toBe('ok');
      expect(envelope.data).toEqual({ installed: '/work/app.apk' });
      expect(calls).toEqual(['/work/app.apk']);
    });

    // #214: the daemon's cwd is not the caller's, so a relative path is
    // resolved here, against the directory the verb was run from.
    test('resolves a relative path against the caller cwd', async () => {
      const calls = [];
      const bridge = { installApp: async (p) => { calls.push(p); } };
      const { envelope } = await handleInstall({ deviceBridge: bridge, cwd: '/work/sub' }, 'build/app.apk');
      expect(calls).toEqual(['/work/sub/build/app.apk']);
      expect(envelope.data).toEqual({ installed: '/work/sub/build/app.apk' });
    });

    test('passes an absolute path through unchanged', async () => {
      const calls = [];
      const bridge = { installApp: async (p) => { calls.push(p); } };
      await handleInstall({ deviceBridge: bridge, cwd: '/work/sub' }, '/abs/app.apk');
      expect(calls).toEqual(['/abs/app.apk']);
    });

    test('normalizes .. segments', async () => {
      const calls = [];
      const bridge = { installApp: async (p) => { calls.push(p); } };
      await handleInstall({ deviceBridge: bridge, cwd: '/work/sub' }, '../build/app.apk');
      expect(calls).toEqual(['/work/build/app.apk']);
    });

    test('rejects a missing path with invalid_input', async () => {
      const bridge = { installApp: async () => { throw new Error('should not be called'); } };
      // The guard runs before resolution: '' must not resolve to the cwd itself.
      const { exitKind } = await handleInstall({ deviceBridge: bridge, cwd: '/work' }, '');
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

    test('real bridge: sends centred geometry and still reports { swiped }', async () => {
      const { DeviceBridge } = require('../../src/device/bridge');
      const calls = [];
      const call = async (tool, args) => {
        calls.push([tool, args]);
        if (tool === 'mobile_get_screen_size') return 'Screen size is 1080x2400 pixels';
        return {};
      };
      const { envelope, exitKind } = await handleSwipe({ deviceBridge: new DeviceBridge({ call }) }, 'left');
      expect(exitKind).toBe('ok');
      expect(envelope.data).toEqual({ swiped: 'left' });
      expect(calls[calls.length - 1]).toEqual(
        ['mobile_swipe_on_screen', { direction: 'left', x: 864, y: 1200, distance: 648 }]
      );
    });

    test('real bridge: an unreadable screen size is an ok:false device envelope', async () => {
      const { DeviceBridge } = require('../../src/device/bridge');
      const calls = [];
      const call = async (tool, args) => {
        calls.push([tool, args]);
        if (tool === 'mobile_get_screen_size') return { width: 0, height: 0, scale: 1 };
        return {};
      };
      const { envelope, exitKind } = await handleSwipe({ deviceBridge: new DeviceBridge({ call }) }, 'up');
      expect(envelope.ok).toBe(false);
      expect(envelope.error.kind).toBe('device');
      expect(exitKind).toBe('device');
      expect(calls.map(([t]) => t)).not.toContain('mobile_swipe_on_screen');
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
      expect(exitKind).toBe('ok');
      expect(envelope.ok).toBe(true);
      expect(envelope.data.mechanical).toBe(true);
      expect(envelope.data.pass).toBe(true);
      expect(envelope.data.needs_agent).toBe(false);
    });

    // #273: a decided failure fails the process (exit 6) so CI sees red
    // without parsing JSON — but the verdict still rides in `data`, unchanged,
    // and the hint is still the exact recording command, so an agent's next
    // step is the same as before.
    test('mechanical fail -> ok:false, test_failed (exit 6), verdict in data', async () => {
      const { envelope, exitKind } = await handleAssert(
        { deviceBridge: fakeBridge([]) },
        'element_exists',
        { target: 'Login' }
      );
      expect(exitKind).toBe('test_failed');
      expect(envelope.ok).toBe(false);
      expect(envelope.error.kind).toBe('test_failed');
      expect(envelope.error.message).toMatch(/^assertion failed: /);
      expect(envelope.data).toEqual({
        type: 'element_exists',
        mechanical: true,
        pass: false,
        needs_agent: false,
        message: expect.any(String),
      });
      expect(envelope.error.message).toBe(`assertion failed: ${envelope.data.message}`);
      expect(envelope.hint).toContain('mauto result add-assertion');
      expect(envelope.hint).toContain('--type element_exists');
      expect(envelope.hint).toContain('--pass false');
      expect(envelope.hint).toContain('--message');
    });

    // Undecided is not failed: Tier 2 is the agent's call, so it stays exit 0.
    test('non-mechanical passes through as needs_agent, still ok / exit 0', async () => {
      const { envelope, exitKind } = await handleAssert(
        { deviceBridge: fakeBridge([]) },
        'screenshot_match',
        {}
      );
      expect(exitKind).toBe('ok');
      expect(envelope.ok).toBe(true);
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
      const validate = createCliAjv().compile(schema);
      expect(validate(f.envelope.data)).toBe(true);
    });

    test('threads a corruption warning into the success envelope hint', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-cli-'));
      const runId = 'run_20260614_130000';
      const dir = path.join(projectRoot, '.mobile-automator', 'results');
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
        screenshot: '.mobile-automator/screenshots/verify_home.png',
        errorMessage: 'Login button not found',
        observation: ['regression:logo is gone', 'state_context:dark mode was active'],
        capture: ['order_id=A-1729'],
      });
      expect(a.exitKind).toBe('ok');
      expect(a.envelope.data.step.screenshot).toBe('.mobile-automator/screenshots/verify_home.png');
      expect(a.envelope.data.step.error_message).toBe('Login button not found');

      const f = handleResultFinalize(deps, { runId, status: 'failed', duration: 3 });
      // A failed run exits 6 (#273), but the full result still rides in data.
      expect(f.exitKind).toBe('test_failed');
      const types = f.envelope.data.observations.map((o) => o.type);
      expect(types).toEqual(['regression', 'state_context']);
      expect(f.envelope.data.observations[0].step_id).toBe('verify_home');
      expect(f.envelope.data.captured_variables).toEqual({ order_id: 'A-1729' });

      const schema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, 'utf8'));
      expect(createCliAjv().compile(schema)(f.envelope.data)).toBe(true);
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
      const file = path.join(deps.projectRoot, '.mobile-automator', 'results', `${runId}.json`);
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
      expect(createCliAjv().compile(schema)(f.envelope.data)).toBe(true);
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

  // #273: the exit code tells CI whether the run passed. The result is still
  // written, retained and harvested on the failed path — exit 6 is a verdict
  // about the app, not a reason to lose the record of it.
  describe('handleResultFinalize exit code follows the finalized status', () => {
    const resultFile = (deps, runId) =>
      path.join(deps.projectRoot, '.mobile-automator', 'results', `${runId}.json`);

    test('status passed -> ok, exit 0', () => {
      const deps = tmpDeps();
      const runId = 'run_20261027_100000';
      handleResultAddStep(deps, { runId, scenarioId: 's', stepId: 'launch', status: 'pass' });
      const f = handleResultFinalize(deps, { runId, status: 'passed' });
      expect(f.exitKind).toBe('ok');
      expect(f.envelope.ok).toBe(true);
      expect(f.envelope.data.status).toBe('passed');
    });

    test('status failed -> ok:false, test_failed, full result in data, file written', () => {
      const deps = tmpDeps();
      const runId = 'run_20261027_100001';
      handleResultAddStep(deps, { runId, scenarioId: 's', stepId: 'verify', status: 'fail' });
      const f = handleResultFinalize(deps, { runId, status: 'failed' });

      expect(f.exitKind).toBe('test_failed');
      expect(f.envelope.ok).toBe(false);
      expect(f.envelope.error).toEqual({ kind: 'test_failed', message: `run ${runId} failed` });
      expect(f.envelope.data.run_id).toBe(runId);
      expect(f.envelope.data.status).toBe('failed');
      expect(f.envelope.data.steps_executed).toHaveLength(1);
      // Default hint: where to look, since there is no store/memory warning.
      expect(f.envelope.hint).toContain('steps_executed');
      expect(f.envelope.hint).toContain(`.mobile-automator/results/${runId}.json`);

      // The data IS the persisted result — not a summary of it.
      const onDisk = JSON.parse(fs.readFileSync(resultFile(deps, runId), 'utf8'));
      expect(f.envelope.data).toEqual(onDisk);
      const schema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, 'utf8'));
      expect(createCliAjv().compile(schema)(f.envelope.data)).toBe(true);
    });

    test('status error -> the same test_failed path, data.status tells them apart', () => {
      const deps = tmpDeps();
      const runId = 'run_20261027_100002';
      handleResultAddStep(deps, { runId, scenarioId: 's', stepId: 'launch', status: 'fail' });
      const f = handleResultFinalize(deps, { runId, status: 'error' });
      expect(f.exitKind).toBe('test_failed');
      expect(f.envelope.ok).toBe(false);
      expect(f.envelope.error).toEqual({ kind: 'test_failed', message: `run ${runId} error` });
      expect(f.envelope.data.status).toBe('error');
      expect(fs.existsSync(resultFile(deps, runId))).toBe(true);
    });

    test('the failure hint names the file the store reports, not a rebuilt path', () => {
      const deps = tmpDeps();
      const runId = 'run_20261027_100003';
      handleResultAddStep(deps, { runId, scenarioId: 's', stepId: 'verify', status: 'fail' });
      // Relocate the store's file: the hint must follow the store, so a future
      // layout move cannot leave the hint pointing at a stale directory.
      const relocated = path.join(deps.projectRoot, 'elsewhere', `${runId}.json`);
      const realFactory = deps.resultStoreFactory;
      deps.resultStoreFactory = (args) => {
        const store = realFactory(args);
        Object.defineProperty(store, 'file', { get: () => relocated });
        return store;
      };
      const f = handleResultFinalize(deps, { runId, status: 'failed' });
      expect(f.exitKind).toBe('test_failed');
      expect(f.envelope.hint).toContain(`the result is saved to ${path.join('elsewhere', `${runId}.json`)}.`);
    });

    test('a failed run is still harvested into memory, and memory warnings stay the hint', () => {
      const deps = tmpDeps();
      const runId = 'run_20261027_100003';
      const recorded = [];
      const memoryStoreFactory = () => ({
        warnings: ['run-history file was unreadable; preserved as sidecar'],
        recordRun(r) { recorded.push(r); },
      });
      handleResultAddStep(deps, { runId, scenarioId: 's', stepId: 'verify', status: 'fail' });
      const f = handleResultFinalize({ ...deps, memoryStoreFactory }, { runId, status: 'failed' });

      expect(f.exitKind).toBe('test_failed');
      expect(recorded).toHaveLength(1);
      expect(recorded[0].status).toBe('failed');
      expect(f.envelope.hint).toContain('preserved as sidecar');
    });
  });

  // #286 review: --status is a documented enum ('passed | failed | error') but
  // was never enforced, so a case variant or typo was persisted verbatim — a
  // schema-invalid result file — with ok:true and exit 0, directly under the
  // exit-6 contract that keys on that status. The boundary is explicit now:
  // anything outside the enum is rejected before anything is written. A
  // PROVIDED-but-empty value is not an omitted one; only absence derives.
  describe('handleResultFinalize rejects a --status outside the schema enum', () => {
    const resultFile = (deps, runId) =>
      path.join(deps.projectRoot, '.mobile-automator', 'results', `${runId}.json`);

    test.each(['FAILED', 'bogus', ''])('--status %j -> invalid_input, exit 3, nothing written', (status) => {
      const deps = tmpDeps();
      const runId = 'run_20261027_100004';
      const f = handleResultFinalize(deps, { runId, status });

      expect(f.exitKind).toBe('invalid_input');
      expect(f.envelope.ok).toBe(false);
      expect(f.envelope.error.kind).toBe('invalid_input');
      expect(f.envelope.error.message).toContain(status === '' ? '""' : status);
      // The hint names the enum AND the derivation, so an agent's next command
      // is one edit away instead of one schema lookup away.
      expect(f.envelope.hint).toContain('passed | failed | error');
      expect(f.envelope.hint).toMatch(/omit --status/i);
      expect(fs.existsSync(resultFile(deps, runId))).toBe(false);
    });
  });

  // #286 review: an unknown step status was silently recorded as 'error' — a
  // mislabelled step with a green exit. Rejected at the boundary instead,
  // before anything is written, under the same all-or-nothing rule as the
  // composite flags.
  describe('handleResultAddStep rejects an unknown --status', () => {
    const resultFile = (deps, runId) =>
      path.join(deps.projectRoot, '.mobile-automator', 'results', `${runId}.json`);

    test.each(['FAILED', 'bogus'])('--status %j -> invalid_input, exit 3, no file', (status) => {
      const deps = tmpDeps();
      const runId = 'run_20261027_100006';
      const a = handleResultAddStep(deps, { runId, scenarioId: 's', stepId: 'launch', status });

      expect(a.exitKind).toBe('invalid_input');
      expect(a.envelope.ok).toBe(false);
      expect(a.envelope.error.kind).toBe('invalid_input');
      expect(a.envelope.hint).toContain('pass | fail | skipped | error');
      expect(fs.existsSync(resultFile(deps, runId))).toBe(false);
    });

    // Every accepted spelling — the friendly forms the usage string documents
    // and the schema's own values — records its schema value, so the E2E
    // harness's 'pass'/'fail' and an agent's 'passed'/'failed' both keep working.
    test('every accepted spelling records its schema value', () => {
      const deps = tmpDeps();
      const runId = 'run_20261027_100007';
      const spellings = {
        pass: 'passed', passed: 'passed',
        fail: 'failed', failed: 'failed',
        skipped: 'skipped', skip: 'skipped',
        error: 'error',
      };
      let i = 0;
      for (const [input, recorded] of Object.entries(spellings)) {
        const a = handleResultAddStep(deps, { runId, scenarioId: 's', stepId: `s${i}`, status: input });
        expect(a.exitKind).toBe('ok');
        expect(a.envelope.data.step.status).toBe(recorded);
        i += 1;
      }
    });
  });

  describe('measured duration', () => {
    function project() {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-finalize-'));
      fs.mkdirSync(path.join(root, '.mobile-automator', '.logs'), { recursive: true });
      return root;
    }

    function trace(root, runId, stamps) {
      fs.writeFileSync(
        path.join(root, '.mobile-automator', '.logs', `run-${runId}.ndjson`),
        stamps
          .map((s) => JSON.stringify({ ts: s.ts, v: 1, src: 'cli', event: s.event || 'verb.end', ...s }))
          .join('\n') + '\n'
      );
    }

    const deps = (projectRoot) => ({
      resultStoreFactory: (a) => new (require('../../src/result/store').ResultStore)(a),
      memoryStoreFactory: null,
      projectRoot,
    });

    test('measures the duration from the trace when one exists', () => {
      const root = project();
      trace(root, 'run_20260905_141500', [
        { ts: '2026-09-05T14:15:00.000Z', ok: true },
        { ts: '2026-09-05T14:17:20.250Z', ok: true },
      ]);
      const r = handleResultFinalize(deps(root), { runId: 'run_20260905_141500' });
      expect(r.envelope.data.duration_seconds).toBe(140.25);
      expect(r.envelope.data.measurements.source).toBe('trace');
    });

    // The point of the slice: a supplied --duration that DISAGREES is recorded
    // and flagged, not silently believed and not silently discarded.
    test('flags a reported duration that disagrees with the measured one', () => {
      const root = project();
      trace(root, 'run_20260905_141501', [
        { ts: '2026-09-05T14:15:00.000Z', ok: true },
        { ts: '2026-09-05T14:17:20.250Z', ok: true },
      ]);
      const r = handleResultFinalize(deps(root), { runId: 'run_20260905_141501', duration: '30' });
      const m = r.envelope.data.measurements;
      expect(r.envelope.data.duration_seconds).toBe(140.25);
      expect(m.reported_duration_seconds).toBe(30);
      expect(m.duration_disagreement).toBe(true);
      expect(r.envelope.data.observations.some((o) => o.type === 'state_context')).toBe(true);
    });

    test('does not flag a reported duration inside the tolerance', () => {
      const root = project();
      trace(root, 'run_20260905_141502', [
        { ts: '2026-09-05T14:15:00.000Z', ok: true },
        { ts: '2026-09-05T14:15:10.000Z', ok: true },
      ]);
      const r = handleResultFinalize(deps(root), { runId: 'run_20260905_141502', duration: '10.5' });
      expect(r.envelope.data.measurements.duration_disagreement).toBe(false);
    });

    // MAUTO_RUN_ID unset, logging silenced, or no workspace: 0.24.0's behaviour,
    // reached deliberately rather than by omission.
    test('falls back to the reported duration with no trace', () => {
      const root = project();
      const r = handleResultFinalize(deps(root), { runId: 'run_20260905_141503', duration: '42' });
      expect(r.envelope.data.duration_seconds).toBe(42);
      expect(r.envelope.data.measurements).toMatchObject({
        source: 'reported',
        reported_duration_seconds: 42,
        duration_disagreement: false,
        trace_events: 0,
      });
    });

    test('records source "none" with neither a trace nor a --duration', () => {
      const root = project();
      const r = handleResultFinalize(deps(root), { runId: 'run_20260905_141504' });
      expect(r.envelope.data.duration_seconds).toBe(0);
      expect(r.envelope.data.measurements.source).toBe('none');
    });

    test('carries the failure screenshots and the device failure count through', () => {
      const root = project();
      trace(root, 'run_20260905_141505', [
        { ts: '2026-09-05T14:15:00.000Z', ok: false, error_kind: 'device' },
        { ts: '2026-09-05T14:15:01.000Z', event: 'screenshot.on_failure', path: '/p/tap.png' },
        { ts: '2026-09-05T14:15:09.000Z', ok: true },
      ]);
      const r = handleResultFinalize(deps(root), { runId: 'run_20260905_141505' });
      expect(r.envelope.data.measurements.device_failures).toBe(1);
      expect(r.envelope.data.measurements.failure_screenshots).toEqual(['/p/tap.png']);
    });

    test('never lets an unreadable trace fail the finalize', () => {
      const root = project();
      // A directory where the trace file should be: readFileSync throws EISDIR.
      fs.mkdirSync(path.join(root, '.mobile-automator', '.logs', 'run-run_20260905_141506.ndjson'));
      const r = handleResultFinalize(deps(root), { runId: 'run_20260905_141506', duration: '9' });
      expect(r.exitKind).toBe('ok');
      expect(r.envelope.data.duration_seconds).toBe(9);
    });

    test('prunes stale traces but never the one it just measured', () => {
      const root = project();
      const dir = path.join(root, '.mobile-automator', '.logs');
      for (let i = 0; i < 25; i += 1) {
        const f = path.join(dir, `run-old${i}.ndjson`);
        fs.writeFileSync(f, '{}\n');
        fs.utimesSync(f, new Date(1e9 + i * 1000), new Date(1e9 + i * 1000));
      }
      trace(root, 'run_20260905_141507', [
        { ts: '2026-09-05T14:15:00.000Z', ok: true },
        { ts: '2026-09-05T14:15:05.000Z', ok: true },
      ]);

      handleResultFinalize(deps(root), { runId: 'run_20260905_141507' });

      const left = fs.readdirSync(dir).filter((n) => n.startsWith('run-'));
      expect(left).toHaveLength(20);
      expect(left).toContain('run-run_20260905_141507.ndjson');
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
      // Keyed on the FINALIZED status, not the flag: no --status was given,
      // the store derived 'failed', and the exit code agrees with the file.
      expect(f.exitKind).toBe('test_failed');
      expect(f.envelope.ok).toBe(false);
      expect(f.envelope.error.kind).toBe('test_failed');
      expect(f.envelope.data.total_assertions).toBe(2);
      expect(f.envelope.data.passed_assertions).toBe(1);
      expect(f.envelope.data.failed_assertions).toBe(1);
      expect(f.envelope.data.status).toBe('failed'); // derived from the failed assertion
      expect(f.envelope.data.assertion_results[1]).toMatchObject({
        status: 'failed', expected: 'Sign in', actual: 'Log in',
      });

      const schema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, 'utf8'));
      expect(createCliAjv().compile(schema)(f.envelope.data)).toBe(true);
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
      expect(fs.existsSync(path.join(projectRoot, '.mobile-automator', 'scenarios'))).toBe(true);
    });

    test('maps agnostic->platform-agnostic and writes config mode', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-setup-'));
      const { envelope } = handleSetup({ projectRoot }, { mode: 'agnostic' });
      expect(envelope.data.mode).toBe('platform-agnostic');
      const cfg = JSON.parse(fs.readFileSync(path.join(projectRoot, '.mobile-automator', 'config.json'), 'utf8'));
      expect(cfg.mode).toBe('platform-agnostic');
    });

    test('refuses when discovery reports a legacy workspace (legacyRoot)', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-setup-legacy-'));
      const { exitKind, envelope } = handleSetup({ projectRoot, legacyRoot: projectRoot }, { mode: 'aware' });
      expect(exitKind).toBe('environment');
      expect(envelope.error.message).toContain('legacy');
      expect(fs.existsSync(path.join(projectRoot, '.mobile-automator'))).toBe(false);
    });

    test('scaffolds normally when no legacy workspace is reported', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-setup-both-'));
      const { envelope } = handleSetup({ projectRoot, legacyRoot: null }, { mode: 'aware' });
      expect(envelope.ok).toBe(true);
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

    it('setup surfaces the telemetry notice in its envelope rather than printing a banner', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-setup-notice-'));
      const { envelope } = handleSetup({ projectRoot }, { mode: 'aware' });
      expect(envelope.data.telemetry).toEqual({
        enabled: false,
        notice: require('../../src/observe/telemetry').CONSENT_NOTICE,
      });
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
        fs.readFileSync(path.join(projectRoot, '.mobile-automator', 'config.json'), 'utf8')
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
        fs.existsSync(path.join(projectRoot, '.mobile-automator', 'config.json'))
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
        fs.existsSync(path.join(projectRoot, '.mobile-automator', 'config.json'))
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
      fs.mkdirSync(path.join(projectRoot, '.mobile-automator'), { recursive: true });
      const configPath = path.join(projectRoot, '.mobile-automator', 'config.json');
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
      fs.mkdirSync(path.join(projectRoot, '.mobile-automator'), { recursive: true });
      fs.writeFileSync(
        path.join(projectRoot, '.mobile-automator', 'config.json'),
        JSON.stringify({ platform_details: 42 })
      );
      const r = handleConfigSet({ projectRoot }, 'project_name', 'Demo');
      expect(r.exitKind).toBe('ok');
    });

    // #251: device ids differ between engines (AVD name vs adb serial), so a
    // switch invalidates a persisted `mauto devices use` selection.
    describe('engine switch (#251)', () => {
      const noEnv = {};
      function fakeStore(initial) {
        let device = initial;
        const calls = { clear: 0 };
        return {
          calls,
          read: () => device,
          write: (_root, id) => (device = String(id)),
          clear: () => {
            calls.clear += 1;
            device = null;
          },
        };
      }
      const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-cfg-engine-'));

      test('a change clears the device selection and reports previous + hint', () => {
        const projectRoot = tmp();
        const store = fakeStore('Pixel_9_Pro');
        const r = handleConfigSet({ projectRoot, env: noEnv, store }, 'engine', 'legacy');
        expect(r.exitKind).toBe('ok');
        expect(r.envelope.ok).toBe(true);
        expect(r.envelope.data).toEqual({
          key: 'engine',
          value: 'legacy',
          previous: 'mobilecli',
          device_selection_cleared: true,
        });
        expect(store.calls.clear).toBe(1);
        expect(store.read()).toBeNull();
        expect(handleConfigGet({ projectRoot }, 'engine').envelope.data.value).toBe('legacy');
        const { hint } = r.envelope;
        expect(hint).toContain('`mauto devices`');
        expect(hint).toContain('`mauto devices use');
        expect(hint).toMatch(/next device verb/);
        expect(hint).toContain('adb shell pkill -f com.mobilenext.mobilecli.DeviceServer');
        expect(hint).toContain('mobilecli#470');
        expect(hint).not.toContain('MOBILEMCP_LEGACY_ROBOT');
      });

      test('with no persisted selection, device_selection_cleared is false', () => {
        const store = fakeStore(null);
        const r = handleConfigSet({ projectRoot: tmp(), env: noEnv, store }, 'engine', 'legacy');
        expect(r.envelope.data.device_selection_cleared).toBe(false);
        expect(r.envelope.hint).toMatch(/next device verb/);
      });

      test('switching back to mobilecli does not carry the legacy-only uiautomator advice', () => {
        const projectRoot = tmp();
        handleConfigSet({ projectRoot, env: noEnv, store: fakeStore(null) }, 'engine', 'legacy');
        const store = fakeStore('emulator-5554');
        const r = handleConfigSet({ projectRoot, env: noEnv, store }, 'engine', 'mobilecli');
        expect(r.envelope.data).toEqual({
          key: 'engine',
          value: 'mobilecli',
          previous: 'legacy',
          device_selection_cleared: true,
        });
        expect(r.envelope.hint).not.toContain('pkill');
      });

      test('setting the effective value again is a plain ok with no side effects', () => {
        const projectRoot = tmp();
        // Missing key == the default (mobilecli).
        const store = fakeStore('Pixel_9_Pro');
        const r = handleConfigSet({ projectRoot, env: noEnv, store }, 'engine', 'mobilecli');
        expect(r.envelope.data).toEqual({ key: 'engine', value: 'mobilecli' });
        expect(r.envelope.hint).toBeUndefined();
        expect(store.calls.clear).toBe(0);
        expect(store.read()).toBe('Pixel_9_Pro');
      });

      test('an exported MOBILEMCP_LEGACY_ROBOT is called out as overriding the key', () => {
        const store = fakeStore(null);
        const r = handleConfigSet(
          { projectRoot: tmp(), env: { MOBILEMCP_LEGACY_ROBOT: '0' }, store },
          'engine',
          'legacy'
        );
        expect(r.envelope.data.value).toBe('legacy');
        expect(r.envelope.hint).toMatch(/MOBILEMCP_LEGACY_ROBOT.*overrides/);
        // The env forces mobilecli: no restart promise, no legacy-only advice.
        expect(r.envelope.hint).toContain('the mobilecli engine keeps running');
        expect(r.envelope.hint).not.toMatch(/next device verb restarts/);
        expect(r.envelope.hint).not.toContain('pkill');
      });

      test('an invalid engine is rejected before any selection is touched', () => {
        const store = fakeStore('Pixel_9_Pro');
        const r = handleConfigSet({ projectRoot: tmp(), env: noEnv, store }, 'engine', 'appium');
        expect(r.exitKind).toBe('invalid_input');
        expect(store.calls.clear).toBe(0);
      });
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

  // #144: a stale host integration is flagged in guide output — and ONLY there
  // (never in emitGuide, which init and the MCP prompts server also consume).
  describe('handleGuide — stale host integration notice', () => {
    const { renderStaleNotice } = require('../../src/init/stale-notice');
    const guideEmitter = require('../../src/guide/emitter');
    const host = (agent, over = {}) => ({
      agent,
      installed: true,
      stale: false,
      files: [{ path: `/p/${agent}/f`, status: 'current' }],
      mcp: null,
      ...over,
    });
    const staleClaude = host('claude', {
      stale: true,
      files: [
        { path: '/p/a', status: 'missing' },
        { path: '/p/b', status: 'outdated' },
      ],
      mcp: { path: '/p/.mcp.json', status: 'current' },
    });
    const freshRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-guide-stale-'));

    test('stale host → raw is the notice followed by the exact guide', () => {
      const projectRoot = freshRoot();
      const report = [staleClaude, host('cursor', { installed: false })];
      const r = handleGuide({ projectRoot, inspect: () => report }, 'execute');
      expect(r.exitKind).toBe('ok');
      const notice = renderStaleNotice([staleClaude]);
      expect(r.raw.startsWith('> **Notice')).toBe(true);
      expect(r.raw).toBe(notice + guideEmitter.emitGuide('execute', { mode: 'platform-aware', projectRoot }));
    });

    test('all hosts current → raw byte-identical to emitGuide', () => {
      const projectRoot = freshRoot();
      const r = handleGuide({ projectRoot, inspect: () => [host('claude'), host('gemini')] }, 'generate');
      expect(r.raw).toBe(guideEmitter.emitGuide('generate', { mode: 'platform-aware', projectRoot }));
    });

    test('nothing installed (real inspector, empty dir) → raw byte-identical to emitGuide', () => {
      const projectRoot = freshRoot();
      const r = handleGuide({ projectRoot }, 'setup');
      expect(r.raw).toBe(guideEmitter.emitGuide('setup', { mode: 'platform-aware', projectRoot }));
    });

    test('inspect throws a filesystem fault (EACCES) → guide still ok, no notice', () => {
      const projectRoot = freshRoot();
      const r = handleGuide(
        {
          projectRoot,
          inspect: () => {
            const e = new Error('EACCES: permission denied');
            e.code = 'EACCES';
            throw e;
          },
        },
        'execute'
      );
      expect(r.exitKind).toBe('ok');
      expect(r.raw).toBe(guideEmitter.emitGuide('execute', { mode: 'platform-aware', projectRoot }));
    });

    test('a non-fs fault in the inspection propagates — a detector defect must be visible, not silently silence the notice', () => {
      const defect = new TypeError('boom: inspect defect');
      expect(() =>
        handleGuide(
          {
            projectRoot: freshRoot(),
            inspect: () => {
              throw defect;
            },
          },
          'execute'
        )
      ).toThrow(defect);
    });

    test('a missing parent dir (ENOENT) is advisory — no notice, guide still ok', () => {
      const projectRoot = freshRoot();
      const r = handleGuide(
        {
          projectRoot,
          inspect: () => {
            const e = new Error("ENOENT: no such file or directory, lstat '/gone'");
            e.code = 'ENOENT';
            throw e;
          },
        },
        'generate'
      );
      expect(r.exitKind).toBe('ok');
      expect(r.raw).toBe(guideEmitter.emitGuide('generate', { mode: 'platform-aware', projectRoot }));
    });

    test('unknown topic never inspects', () => {
      const inspect = jest.fn(() => [staleClaude]);
      const r = handleGuide({ projectRoot: freshRoot(), inspect }, 'bogus');
      expect(r.exitKind).toBe('invalid_input');
      expect(inspect).not.toHaveBeenCalled();
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
    test('claude applies into the injected projectRoot and reports per-file changes', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-init-h-'));
      const { envelope, exitKind } = handleInit({ projectRoot }, 'claude');
      expect(exitKind).toBe('ok');
      expect(envelope.ok).toBe(true);
      expect(envelope.data.agent).toBe('claude');
      expect(Array.isArray(envelope.data.changes)).toBe(true);
      expect(envelope.data.changes.every((c) => c.path && c.status)).toBe(true);
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
      const resolveEngine = () => ({ engine: 'legacy', source: 'config' });
      const { envelope, exitKind } = await handleSessionStart(
        { projectRoot, spawn, client, resolveEngine },
        { device: 'A', idle: '1000' }
      );
      expect(exitKind).toBe('ok');
      expect(envelope.data).toEqual({ started: true, device: 'A', engine: 'legacy' });
      expect(spawned.device).toBe('A');
      expect(spawned.idleMs).toBe(1000);
      // #251: the workspace's resolved engine reaches the spawned daemon.
      expect(spawned.engine).toBe('legacy');
      expect(spawned.engineSource).toBe('config');
    });

    test('an already-running daemon reports its own engine, with a hint when stale (#251)', async () => {
      const spawn = { spawnDaemon: async () => { throw new Error('should not spawn'); } };
      const client = { isAlive: async () => true };
      const { envelope, exitKind } = await handleSessionStart(
        {
          projectRoot, spawn, client,
          // One read, both projections: the daemon's pin and its engine.
          readHandle: () => ({ device: 'A', engine: 'mobilecli' }),
          resolveEngine: () => ({ engine: 'legacy', source: 'config' }),
        },
        {}
      );
      expect(exitKind).toBe('ok');
      expect(envelope.data.already_running).toBe(true);
      expect(envelope.data.engine).toBe('mobilecli');
      expect(envelope.hint).toContain('legacy');
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
      const readHandle = () => ({ device: 'A' });
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
      const readHandle = () => ({ device: 'A' });
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
      const readHandle = () => ({ device: 'A' });
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
    const defaultEngine = () => ({ engine: 'mobilecli', source: 'default' });

    test('reports running:true with in_flight and device from the client', async () => {
      const up = await handleSessionStatus({
        projectRoot: '/x',
        client: { getSessionStatus: async () => ({ running: true, in_flight: 2, device: 'A' }) },
        resolveEngine: defaultEngine,
      });
      expect(up.exitKind).toBe('ok');
      expect(up.envelope.data).toEqual({
        running: true, reason: null, in_flight: 2, device: 'A',
        log_path: sessionPaths.logFilePath('/x'), session_id: null,
        engine: 'mobilecli', engine_source: null,
        resolved_engine: 'mobilecli', resolved_engine_source: 'default',
      });
    });

    test('reports running:false with null in_flight/device when no daemon is up', async () => {
      const down = await handleSessionStatus({
        projectRoot: '/x',
        client: { getSessionStatus: async () => ({ running: false, in_flight: null, device: null }) },
        resolveEngine: defaultEngine,
      });
      expect(down.exitKind).toBe('ok');
      // log_path survives the not-running shape: that is when it is needed.
      expect(down.envelope.data).toEqual({
        running: false, reason: null, in_flight: null, device: null,
        log_path: sessionPaths.logFilePath('/x'), session_id: null,
        engine: null, engine_source: null,
        resolved_engine: 'mobilecli', resolved_engine_source: 'default',
      });
    });

    // #251: a live daemon on a different engine than the workspace resolves is
    // stale; the next device verb restarts it. Say so.
    test('a running daemon on a stale engine carries a hint naming the restart', async () => {
      const r = await handleSessionStatus({
        projectRoot: '/x',
        client: { getSessionStatus: async () => ({ running: true, in_flight: 0, device: 'A' }) },
        resolveEngine: () => ({ engine: 'legacy', source: 'config' }),
      });
      expect(r.exitKind).toBe('ok');
      expect(r.envelope.data.engine).toBe('mobilecli');
      expect(r.envelope.data.resolved_engine).toBe('legacy');
      expect(r.envelope.hint).toContain('legacy');
      expect(r.envelope.hint).toContain('restart');
    });

    test('a dead engine: running:false with a hint that says why (#156)', async () => {
      const r = await handleSessionStatus({
        projectRoot: '/x',
        client: { getSessionStatus: async () => ({ running: false, reason: 'engine_exited', in_flight: 0, device: 'A' }) },
      });
      expect(r.exitKind).toBe('ok');
      expect(r.envelope.data.running).toBe(false);
      expect(r.envelope.data.reason).toBe('engine_exited');
      expect(r.envelope.hint).toContain('device engine exited');
      expect(r.envelope.hint).toContain(sessionPaths.logFilePath('/x'));
    });

    test('a healthy session carries no hint', async () => {
      const r = await handleSessionStatus({
        projectRoot: '/x',
        client: { getSessionStatus: async () => ({ running: true, in_flight: 0, device: 'A' }) },
        resolveEngine: defaultEngine,
      });
      expect(r.envelope.hint).toBeUndefined();
    });
  });

  describe('handleSessionEnd (#156)', () => {
    // Stub session-end.endSession's dependencies so it returns a chosen outcome.
    function run(outcome) {
      const reaper = {
        waitForDeath: async () => outcome !== 'escalated' && outcome !== 'survived',
        terminate: async () => (outcome === 'escalated' ? 'dead' : 'survived'),
      };
      return handleSessionEnd({
        projectRoot: '/x',
        client: { requestShutdown: async () => outcome !== 'none' },
        end: {
          readPid: () => (outcome === 'none' ? null : 4000),
          identify: () => 'ours',
          reaper,
        },
      });
    }

    test('stopped cleanly: ok, forced:false, no hint', async () => {
      const r = await run('clean');
      expect(r.exitKind).toBe('ok');
      expect(r.envelope.data).toEqual({ stopped: true, already_stopped: false, forced: false });
      expect(r.envelope.hint).toBeUndefined();
    });

    test('stopped by escalation: ok, forced:true, hint names the pid', async () => {
      const r = await run('escalated');
      expect(r.exitKind).toBe('ok');
      expect(r.envelope.data).toEqual({ stopped: true, already_stopped: false, forced: true });
      expect(r.envelope.hint).toContain('terminated pid 4000');
    });

    test('nothing running: ok, already_stopped', async () => {
      const r = await run('none');
      expect(r.exitKind).toBe('ok');
      expect(r.envelope.data).toEqual({ stopped: false, already_stopped: true, forced: false });
    });

    test('survivor: fail(device) with the pid, pidfile and log in the hint', async () => {
      const r = await run('survived');
      expect(r.exitKind).toBe('device');
      expect(r.envelope.ok).toBe(false);
      expect(r.envelope.error.message).toBe('device session daemon pid 4000 did not exit');
      expect(r.envelope.data).toEqual({ stopped: false, already_stopped: false, pid: 4000 });
      expect(r.envelope.hint).toContain(sessionPaths.pidFilePath('/x'));
      expect(r.envelope.hint).toContain(sessionPaths.logFilePath('/x'));
      expect(r.envelope.hint).toContain('still alive after SIGTERM and SIGKILL');
      expect(r.envelope.hint).toContain('kill -9 4000');
    });

    // Each failure outcome gets the hint that is true for it, not one hint
    // hedging across all three.
    function runStuck(identity, { acked = true } = {}) {
      return handleSessionEnd({
        projectRoot: '/x',
        client: { requestShutdown: async () => acked },
        end: {
          readPid: () => 4000,
          readLockPid: () => null,
          identify: () => identity,
          reaper: { waitForDeath: async () => false, terminate: async () => { throw new Error('signalled'); } },
        },
      });
    }

    test.each([
      ['foreign', true, /cannot be tied to this workspace, so it was not signalled/],
      // #237: acked, marker-less, but the lock does not name the same pid.
      ['unmarked', true, /cannot be tied to this workspace, so it was not signalled/],
      ['unknown', true, /could not be identified \(`ps` failed\), so it was not signalled/],
      // #237: a marker-less (mauto < 0.28) daemon that did not answer.
      ['unmarked', false, /did not answer the shutdown and its command line carries no workspace marker/],
    ])('%s identity (acked: %s): fail(device), never signalled, with its own hint', async (identity, acked, hint) => {
      const r = await runStuck(identity, { acked });
      expect(r.exitKind).toBe('device');
      expect(r.envelope.error.message).toBe('device session daemon pid 4000 did not exit');
      expect(r.envelope.data).toEqual({ stopped: false, already_stopped: false, pid: 4000 });
      expect(r.envelope.hint).toMatch(hint);
      expect(r.envelope.hint).not.toContain('SIGKILL');
      expect(r.envelope.hint).toContain(sessionPaths.pidFilePath('/x'));
      expect(r.envelope.hint).toContain(sessionPaths.logFilePath('/x'));
    });

    test('an unproven daemon (#237) is a failure that tells the user how to stop it', async () => {
      const r = await runStuck('unmarked', { acked: false });
      expect(r.envelope.ok).toBe(false);
      expect(r.envelope.error.kind).toBe('device');
      expect(r.envelope.data).toEqual({ stopped: false, already_stopped: false, pid: 4000 });
      expect(r.envelope.hint).toContain('ps -p 4000');
      expect(r.envelope.hint).toContain('kill -9 4000');
      expect(r.envelope.hint).toContain('mauto < 0.28');
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
        readHandle: () => ({ device: 'A' }),
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

  describe('launch / terminate parsing (buildProgram)', () => {
    async function runLaunchVerb(argv) {
      const calls = [];
      const deviceBridgeFactory = async () => ({
        bridge: {
          restartApp: async (a) => { calls.push(['restart', a]); },
          terminateApp: async (a) => { calls.push(['terminate', a]); },
          launchApp: async (a) => { calls.push(['launch', a]); },
        },
        close: async () => {},
      });
      const emitted = [];
      const program = buildProgram({
        projectRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-launch-')),
        deviceBridgeFactory,
        emit: (r) => { emitted.push(r); },
      });
      await program.parseAsync(['node', 'mauto', ...argv]);
      return { calls, emitted };
    }

    test('`launch <id>` cold-starts', async () => {
      const { calls } = await runLaunchVerb(['launch', 'com.x']);
      expect(calls).toEqual([['restart', 'com.x']]);
    });

    test('`launch <id> --resume` only launches', async () => {
      const { calls } = await runLaunchVerb(['launch', 'com.x', '--resume']);
      expect(calls).toEqual([['launch', 'com.x']]);
    });

    test('`terminate <id>` only terminates', async () => {
      const { calls } = await runLaunchVerb(['terminate', 'com.x']);
      expect(calls).toEqual([['terminate', 'com.x']]);
    });
  });

  // Screenshot-on-failure hooks connectBridge's SECOND try — after fn(bridge)
  // has produced its verdict, before finally closes the connection — because
  // that is the only window where the bridge is still live. The connect
  // FAILURE catch has no bridge to photograph with; wiring the capture there
  // by mistake would silently do nothing forever, since captureOnFailure
  // gracefully no-ops on a missing bridge. The proof that matters is therefore
  // the positive case below: a bridge that connects successfully and CAN take
  // a screenshot must actually have it called after a device-kind failure.
  describe('screenshot-on-failure wiring (buildProgram)', () => {
    function tmpRoot() {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-failcap-cli-'));
      // A real workspace: the capture and the trace sink both treat an
      // existing .mobile-automator/ as the permission to write (#188). A bare
      // root leaves both silent — which is the no-workspace behavior, not
      // the one under test here.
      fs.mkdirSync(path.join(root, '.mobile-automator'), { recursive: true });
      return root;
    }

    async function withRunId(runId, fn) {
      const original = process.env.MAUTO_RUN_ID;
      process.env.MAUTO_RUN_ID = runId;
      try {
        return await fn();
      } finally {
        if (original === undefined) delete process.env.MAUTO_RUN_ID;
        else process.env.MAUTO_RUN_ID = original;
      }
    }

    function traceEvents(root, runId) {
      const file = path.join(root, '.mobile-automator', '.logs', `run-${runId}.ndjson`);
      return fs.existsSync(file)
        ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
        : [];
    }

    test('captures a screenshot after fn(bridge) returns a device failure, in the live-bridge window', async () => {
      const root = tmpRoot();
      const shots = [];
      const deviceBridgeFactory = async () => ({
        bridge: {
          listElements: async () => {
            throw new Error('element not found');
          },
          async screenshot(dest) {
            shots.push(dest);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, 'PNG');
            return dest;
          },
        },
        close: async () => {},
      });
      const emitted = [];

      await withRunId('wiring-smoke', () =>
        buildProgram({
          projectRoot: root,
          deviceBridgeFactory,
          emit: (r) => emitted.push(r),
        }).parseAsync(['node', 'mauto', 'elements'])
      );

      expect(shots).toHaveLength(1);
      expect(emitted).toHaveLength(1);
      expect(emitted[0].exitKind).toBe('device');
      expect(emitted[0].envelope.ok).toBe(false);

      const events = traceEvents(root, 'wiring-smoke');
      expect(events).toContainEqual(expect.objectContaining({ event: 'screenshot.on_failure', verb: 'elements' }));
    });

    test('never attempts a capture when the CONNECT itself fails — there is no bridge there', async () => {
      const root = tmpRoot();
      const deviceBridgeFactory = async () => {
        throw new Error('no device found');
      };
      const emitted = [];

      await withRunId('wiring-connect-fail', () =>
        buildProgram({
          projectRoot: root,
          deviceBridgeFactory,
          emit: (r) => emitted.push(r),
        }).parseAsync(['node', 'mauto', 'elements'])
      );

      expect(emitted).toHaveLength(1);
      expect(emitted[0].exitKind).toBe('device');
      const events = traceEvents(root, 'wiring-connect-fail');
      expect(events.some((e) => typeof e.event === 'string' && e.event.startsWith('screenshot.'))).toBe(false);
    });

    // THE property this task exists to prove: a screenshot capture that itself
    // fails must never mask, replace, or delay the original device envelope
    // that reaches the caller.
    test('a screenshot capture failure never masks the original device envelope', async () => {
      const root = tmpRoot();
      const deviceBridgeFactory = async () => ({
        bridge: {
          listElements: async () => {
            throw new Error('element not found');
          },
          async screenshot() {
            throw new Error('daemon socket closed');
          },
        },
        close: async () => {},
      });
      const emitted = [];

      await withRunId('wiring-shot-fail', () =>
        buildProgram({
          projectRoot: root,
          deviceBridgeFactory,
          emit: (r) => emitted.push(r),
        }).parseAsync(['node', 'mauto', 'elements'])
      );

      expect(emitted).toHaveLength(1);
      const { envelope, exitKind } = emitted[0];
      expect(exitKind).toBe('device');
      expect(envelope.ok).toBe(false);
      expect(envelope.error.message).toBe('element not found');

      const events = traceEvents(root, 'wiring-shot-fail');
      expect(events).toContainEqual(expect.objectContaining({ event: 'screenshot.capture_failed', verb: 'elements' }));
    });
  });

  // Crash-probe wiring: connectBridge's SECOND try, same window as
  // screenshot-on-failure, called first (see the comment at the call site).
  describe('crash-probe wiring (buildProgram)', () => {
    function tmpRoot() {
      return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-crashprobe-cli-'));
    }

    function writeHandle(root, handle) {
      fs.mkdirSync(sessionPaths.sessionDir(root), { recursive: true });
      fs.writeFileSync(sessionPaths.handlePath(root), JSON.stringify(handle));
    }

    // probeCrashes records through the plain recorder (mauto.ndjson), not the
    // per-run trace — unlike captureOnFailure it carries no run_id and needs no
    // run correlation, matching the plan's own probeCrashes signature/tests,
    // neither of which take a runId.
    function mainLogEvents(root) {
      const file = path.join(root, '.mobile-automator', '.logs', 'mauto.ndjson');
      return fs.existsSync(file)
        ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
        : [];
    }

    const RECENT_CRASH = { id: 'c1', process: 'com.acme.app', timestamp: '2026-09-05T10:30:00.000Z' };
    const STARTED_AT = '2026-09-05T10:00:00.000Z';

    test('attaches crashes to a device-failure envelope when a watermark exists', async () => {
      const root = tmpRoot();
      writeHandle(root, { started_at: STARTED_AT });
      const listCrashesCalls = [];
      const deviceBridgeFactory = async () => ({
        bridge: {
          listElements: async () => {
            throw new Error('element not found');
          },
          listCrashes: async () => {
            listCrashesCalls.push(true);
            return [RECENT_CRASH];
          },
        },
        close: async () => {},
      });
      const emitted = [];

      await buildProgram({
        projectRoot: root,
        deviceBridgeFactory,
        emit: (r) => emitted.push(r),
      }).parseAsync(['node', 'mauto', 'elements']);

      expect(listCrashesCalls).toHaveLength(1);
      expect(emitted).toHaveLength(1);
      expect(emitted[0].exitKind).toBe('device');
      expect(emitted[0].envelope.ok).toBe(false);
      expect(emitted[0].envelope.error.message).toBe('element not found');
      expect(emitted[0].envelope.data.crashes).toEqual([RECENT_CRASH]);
      expect(emitted[0].envelope.hint).toMatch(/crash/i);

      const events = mainLogEvents(root);
      expect(events).toContainEqual(expect.objectContaining({ event: 'crash.detected', verb: 'elements' }));
    });

    test('amends only the hint, never `data`, on an ok:true empty-elements envelope', async () => {
      const root = tmpRoot();
      writeHandle(root, { started_at: STARTED_AT });
      const deviceBridgeFactory = async () => ({
        bridge: {
          listElements: async () => [],
          listCrashes: async () => [RECENT_CRASH],
        },
        close: async () => {},
      });
      const emitted = [];

      await buildProgram({
        projectRoot: root,
        deviceBridgeFactory,
        emit: (r) => emitted.push(r),
      }).parseAsync(['node', 'mauto', 'elements']);

      expect(emitted).toHaveLength(1);
      expect(emitted[0].envelope.ok).toBe(true);
      expect(emitted[0].envelope.data).toEqual([]);
      expect(emitted[0].envelope.hint).toMatch(/crash/i);
    });

    test('`devices` is exempt from the empty-array trigger', async () => {
      const root = tmpRoot();
      writeHandle(root, { started_at: STARTED_AT });
      const listCrashesCalls = [];
      const deviceBridgeFactory = async () => ({
        bridge: {
          listDevices: async () => [],
          listCrashes: async () => {
            listCrashesCalls.push(true);
            return [RECENT_CRASH];
          },
        },
        close: async () => {},
      });
      const emitted = [];

      await buildProgram({
        projectRoot: root,
        deviceBridgeFactory,
        emit: (r) => emitted.push(r),
      }).parseAsync(['node', 'mauto', 'devices']);

      expect(listCrashesCalls).toHaveLength(0);
      expect(emitted[0].envelope.data).toEqual([]);
      expect('hint' in emitted[0].envelope).toBe(false);
    });

    test('a non-device failure kind (invalid_input) never triggers the probe', async () => {
      const root = tmpRoot();
      writeHandle(root, { started_at: STARTED_AT });
      const listCrashesCalls = [];
      const deviceBridgeFactory = async () => ({
        bridge: {
          tap: async () => {
            throw new Error('unreachable');
          },
          listCrashes: async () => {
            listCrashesCalls.push(true);
            return [RECENT_CRASH];
          },
        },
        close: async () => {},
      });
      const emitted = [];

      // An unparseable --at never reaches the device: handleTap returns
      // invalid_input before calling deviceBridge.tap at all.
      await buildProgram({
        projectRoot: root,
        deviceBridgeFactory,
        emit: (r) => emitted.push(r),
      }).parseAsync(['node', 'mauto', 'tap', '--at', 'not-coords']);

      expect(listCrashesCalls).toHaveLength(0);
      expect(emitted[0].exitKind).toBe('invalid_input');
      expect('data' in emitted[0].envelope).toBe(false);
    });

    test('with no session handle, the probe attaches nothing — unscoped, not earned-empty', async () => {
      const root = tmpRoot(); // no writeHandle(): no session.json
      const listCrashesCalls = [];
      const deviceBridgeFactory = async () => ({
        bridge: {
          listElements: async () => {
            throw new Error('element not found');
          },
          listCrashes: async () => {
            listCrashesCalls.push(true);
            return [RECENT_CRASH];
          },
        },
        close: async () => {},
      });
      const emitted = [];

      await buildProgram({
        projectRoot: root,
        deviceBridgeFactory,
        emit: (r) => emitted.push(r),
      }).parseAsync(['node', 'mauto', 'elements']);

      expect(listCrashesCalls).toHaveLength(0);
      expect('data' in emitted[0].envelope).toBe(false);
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
      for (const [, dir] of [
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

    // --- Issue #144: per-file change report + refresh hint ----------------
    function seedPre021(root) {
      for (const topic of ['generate', 'execute', 'setup']) {
        const f = pathForInit.join(root, '.claude', 'commands', `mobile-automator-${topic}.md`);
        fsForInit.mkdirSync(pathForInit.dirname(f), { recursive: true });
        fsForInit.writeFileSync(
          f,
          `Run \`mauto guide ${topic}\` and follow it. Drive the device only through \`mauto\` verbs (never assume resource-ids).\n`
        );
      }
      // Byte-for-byte what a pre-0.21 init's merge wrote (2-space JSON + newline).
      // init canonicalises the file's formatting on every run, so a compact
      // fixture would also report the mcp file as 'updated'.
      fsForInit.writeFileSync(
        pathForInit.join(root, '.mcp.json'),
        JSON.stringify({ mcpServers: { mauto: { command: 'mauto', args: ['mcp'] } } }, null, 2) + '\n'
      );
    }

    test('single agent: data.changes lists every owned file + the mcp config, in plan order', () => {
      const projectRoot = initTmpRoot();
      const { planHost } = require('../../src/init/host-plan');
      const r = handleInit({ projectRoot }, 'claude');
      expect(r.exitKind).toBe('ok');
      const { changes } = r.envelope.data;
      const plan = planHost('claude');
      const expected = plan.files
        .map((f) => path.join(projectRoot, f.rel))
        .concat(plan.mcp ? [path.join(projectRoot, plan.mcp)] : []);
      // `changes` is the only per-file record the init envelope carries.
      expect(Object.keys(r.envelope.data).sort()).toEqual(['agent', 'changes']);
      expect(changes.map((c) => c.path)).toEqual(expected);
      expect(changes.every((c) => c.status === 'created')).toBe(true);
    });

    test('all: every data.agents[] entry carries its own changes', () => {
      const projectRoot = initTmpRoot();
      const r = handleInit({ projectRoot }, 'all');
      expect(r.exitKind).toBe('ok');
      for (const a of r.envelope.data.agents) {
        expect(Array.isArray(a.changes)).toBe(true);
        expect(a.changes.length).toBeGreaterThan(0);
        expect(a.changes.every((c) => c.status === 'created')).toBe(true);
      }
    });

    test('a fresh install carries no refresh hint', () => {
      const r = handleInit({ projectRoot: initTmpRoot() }, 'claude');
      expect(r.envelope.hint).toBeUndefined();
    });

    test('an unchanged rerun carries no refresh hint', () => {
      const projectRoot = initTmpRoot();
      handleInit({ projectRoot }, 'claude');
      const r = handleInit({ projectRoot }, 'claude');
      expect(r.envelope.data.changes.every((c) => c.status === 'unchanged')).toBe(true);
      expect(r.envelope.hint).toBeUndefined();
    });

    test('a pre-0.21 workspace: init refreshes it and says so in the hint', () => {
      const projectRoot = initTmpRoot();
      seedPre021(projectRoot);
      const r = handleInit({ projectRoot }, 'claude');
      expect(r.exitKind).toBe('ok');
      const statuses = r.envelope.data.changes.map((c) => c.status);
      // 3 outdated commands updated + 3 skills created; mcp already current.
      expect(statuses.filter((s) => s === 'updated')).toHaveLength(3);
      expect(statuses.filter((s) => s === 'created')).toHaveLength(3);
      expect(r.envelope.hint).toBe('refreshed 6 stale file(s) for claude');
    });

    test('all on a pre-0.21 workspace: hint names only the already-installed host', () => {
      const projectRoot = initTmpRoot();
      seedPre021(projectRoot);
      const r = handleInit({ projectRoot }, 'all');
      expect(r.exitKind).toBe('ok');
      expect(r.envelope.hint).toBe('refreshed 6 stale file(s) for claude');
    });

    test('the pre-run inspection is injectable', () => {
      const projectRoot = initTmpRoot();
      const inspect = () => [{ agent: 'gemini', installed: true }];
      const r = handleInit({ projectRoot, inspect }, 'gemini');
      expect(r.envelope.hint).toBe('refreshed 3 stale file(s) for gemini');
    });

    test('all: a failure hint is never overridden by the refresh hint', () => {
      const projectRoot = initTmpRoot();
      seedPre021(projectRoot);
      const { ADAPTERS } = require('../../src/init/adapters');
      const adapters = { ...ADAPTERS, copilot: { apply() { throw new Error('nope'); } } };
      const r = handleInit({ projectRoot, adapters }, 'all');
      expect(r.envelope.error.kind).toBe('partial_failure');
      expect(r.envelope.hint).toMatch(/data\.agents\[\]\.error/);
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
          '--screenshot', '.mobile-automator/screenshots/step_1.png',
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

      // Every scalar add-step flag landed on the store.addStep call. The
      // status arrives VALIDATED and normalized: the boundary hands the store
      // a schema value, not the raw flag (#286 review).
      expect(calls.addStep).toEqual([
        {
          step_id: 'step_1',
          status: 'failed',
          attempts: 3,
          screenshot: '.mobile-automator/screenshots/step_1.png',
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
          // No trace exists for this run id, so measureRun falls back to the
          // reported value — the same fallback the 'measured duration' suite
          // covers directly.
          measurements: {
            source: 'reported',
            duration_disagreement: false,
            reported_duration_seconds: 12,
            trace_events: 0,
            device_failures: 0,
            trace_truncated: false,
            failure_screenshots: [],
          },
          summary: 'Custom narrative summary.',
        },
      ]);
    });
  });
});

describe('mauto telemetry', () => {
  const telemetryModule = require('../../src/observe/telemetry');
  const { EVENT_FIELDS, NEVER_SENDS } = require('../../src/observe/event');

  function workspace(config = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-tv-'));
    fs.mkdirSync(path.join(root, '.mobile-automator'), { recursive: true });
    fs.writeFileSync(path.join(root, '.mobile-automator', 'config.json'), JSON.stringify(config, null, 2));
    return root;
  }

  beforeEach(() => telemetryModule._resetMemo());

  it('reports off, and says exactly how to turn it on', () => {
    const root = workspace({});
    const { envelope, exitKind } = handleTelemetryStatus({ projectRoot: root, env: {} });
    expect(exitKind).toBe('ok');
    expect(envelope.ok).toBe(true);
    expect(envelope.data.enabled).toBe(false);
    expect(envelope.data.reason).toBe('not_configured');
    expect(envelope.data.enable_with).toBe('mauto telemetry enable');
  });

  it('reports the device engine\'s own telemetry, off by default (#213)', () => {
    const root = workspace({});
    const { envelope } = handleTelemetryStatus({ projectRoot: root, env: {} });
    expect(envelope.data.engine).toEqual({ enabled: false, reason: 'default_off' });
  });

  it('reports an engine opt-in, and a kill switch overriding it (#213)', () => {
    const root = workspace({});
    expect(handleTelemetryStatus({ projectRoot: root, env: { MOBILEMCP_DISABLE_TELEMETRY: '' } }).envelope.data.engine)
      .toEqual({ enabled: true, reason: 'user_env' });
    telemetryModule._resetMemo();
    expect(handleTelemetryStatus({ projectRoot: root, env: { MOBILEMCP_DISABLE_TELEMETRY: '', MAUTO_TELEMETRY: '0' } }).envelope.data.engine)
      .toEqual({ enabled: false, reason: 'kill_switch' });
  });

  it('renders the field list from the catalog, not from prose', () => {
    const root = workspace({});
    const { envelope } = handleTelemetryStatus({ projectRoot: root, env: {} });
    expect(envelope.data.fields_sent.sort())
      .toEqual(Object.keys(EVENT_FIELDS).filter((k) => EVENT_FIELDS[k].sends).sort());
    expect(envelope.data.fields_never_sent.sort()).toEqual([...NEVER_SENDS].sort());
    expect(envelope.data.notice).toBe(telemetryModule.CONSENT_NOTICE);
  });

  it('reports the spool so a user can see what is queued before opting in', () => {
    const root = workspace({});
    const { envelope } = handleTelemetryStatus({ projectRoot: root, env: {} });
    expect(envelope.data.spool).toEqual({
      path: expect.stringContaining('telemetry.spool'),
      bytes: 0,
      events: 0,
      pending_batches: 0,
    });
  });

  it('enable writes the config key', () => {
    const root = workspace({});
    const { envelope } = handleTelemetryEnable({ projectRoot: root, env: { MAUTO_TELEMETRY_TOKEN: 'phc_real' } });
    expect(envelope.ok).toBe(true);
    expect(envelope.data.enabled).toBe(true);
    const cfg = JSON.parse(fs.readFileSync(path.join(root, '.mobile-automator', 'config.json'), 'utf8'));
    expect(cfg.telemetry.enabled).toBe(true);
  });

  it('enable under a kill switch writes the intent but does NOT claim to be on', () => {
    const root = workspace({});
    const { envelope } = handleTelemetryEnable({
      projectRoot: root,
      env: { MAUTO_TELEMETRY_TOKEN: 'phc_real', MAUTO_TELEMETRY: '0' },
    });
    expect(envelope.ok).toBe(true);
    expect(envelope.data.enabled).toBe(false);
    expect(envelope.data.reason).toBe('kill_switch');
    expect(envelope.hint).toMatch(/MAUTO_TELEMETRY/);
    // The durable intent is still recorded — the env var is this shell's
    // override, not a rewrite of what the project owner asked for.
    const cfg = JSON.parse(fs.readFileSync(path.join(root, '.mobile-automator', 'config.json'), 'utf8'));
    expect(cfg.telemetry.enabled).toBe(true);
  });

  it('disable writes false and reports off', () => {
    const root = workspace({ telemetry: { enabled: true } });
    const { envelope } = handleTelemetryDisable({ projectRoot: root, env: {} });
    expect(envelope.data.enabled).toBe(false);
    const cfg = JSON.parse(fs.readFileSync(path.join(root, '.mobile-automator', 'config.json'), 'utf8'));
    expect(cfg.telemetry.enabled).toBe(false);
  });

  it('flush drains the spool through an injected flusher, never touching the real transport', async () => {
    const root = workspace({ telemetry: { enabled: true } });
    const calls = [];
    const flusher = async () => {
      calls.push(true);
      return { sent: 3, dropped: 1, kept: 0, kept_events: 0, ok: false };
    };
    const { envelope, exitKind } = await handleTelemetryFlush({ projectRoot: root, env: {}, flusher });
    expect(exitKind).toBe('ok');
    expect(calls).toHaveLength(1);
    expect(envelope.data).toMatchObject({ sent: 3, dropped: 1, kept: 0, kept_events: 0, ok: false });
    // The envelope's ok says the verb ran; data.ok carries the flush's verdict,
    // and a permanent drop gets the hint that explains it.
    expect(envelope.ok).toBe(true);
    expect(envelope.hint).toMatch(/permanently discarded/);
    expect(envelope.data.spool).toMatchObject({ events: 0 });
  });

  it('flush explains kept batches without claiming the verb failed', async () => {
    const root = workspace({ telemetry: { enabled: true } });
    const flusher = async () => ({ sent: 0, dropped: 0, kept: 1, kept_events: 40, ok: false });
    const { envelope, exitKind } = await handleTelemetryFlush({ projectRoot: root, env: {}, flusher });
    expect(exitKind).toBe('ok');
    expect(envelope.ok).toBe(true);
    expect(envelope.data).toMatchObject({ kept: 1, kept_events: 40, ok: false });
    expect(envelope.hint).toMatch(/kept for retry/);
  });

  it('registers all four telemetry subcommands', () => {
    const cmd = buildProgram().commands.find((c) => c.name() === 'telemetry');
    expect(cmd).toBeDefined();
    expect(cmd.commands.map((c) => c.name()).sort()).toEqual(['disable', 'enable', 'flush', 'status']);
  });
});
