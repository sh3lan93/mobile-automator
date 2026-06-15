'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

const {
  handleElements,
  handleScreenshot,
  handleValidate,
} = require('../../src/cli');
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
});
