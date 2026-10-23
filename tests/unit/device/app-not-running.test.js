'use strict';

const { isAppNotRunning } = require('../../../src/device/app-not-running');

// Verbatim error.message strings captured through `mauto terminate` (#255).
const SIMCTL_NOT_RUNNING =
  'Error: Command failed: /path/to/node_modules/@mobilenext/mobilecli-darwin-arm64/mobilecli-darwin-arm64 ' +
  'apps terminate com.apple.Preferences --device 92D11D30-5566-4A86-BF94-DE09B134F59D\n' +
  'failed to terminate app on device 92D11D30-5566-4A86-BF94-DE09B134F59D: ' +
  'failed to execute xcrun simctl command: exit status 3\n';

// Source-verified (mobilecli 1.0.13 devices/ios.go + commands/apps.go), not device-probed.
const REAL_IOS_NOT_RUNNING =
  'Error: Command failed: mobilecli apps terminate com.example.app --device 00008110-000A1C2E0C12801E\n' +
  'failed to terminate app on device 00008110-000A1C2E0C12801E: process of com.example.app not found\n';

describe('isAppNotRunning', () => {
  test.each([
    ['iOS simulator (simctl exit 3)', SIMCTL_NOT_RUNNING],
    ['real iOS on mobilecli (process not found)', REAL_IOS_NOT_RUNNING],
  ])('recognises %s', (_label, message) => {
    expect(isAppNotRunning(new Error(message))).toBe(true);
  });

  test.each([
    ['another simctl exit status', SIMCTL_NOT_RUNNING.replace('exit status 3', 'exit status 149')],
    ['a multi-digit exit status starting with 3', SIMCTL_NOT_RUNNING.replace('exit status 3', 'exit status 31')],
    ['an app that is not installed', 'failed to terminate app: app com.example.app is not installed'],
    ['a device error', 'Device "emulator-5554" not found'],
    ['a process message without the bundle', 'process not found'],
    ['an empty message', ''],
  ])('rejects %s', (_label, message) => {
    expect(isAppNotRunning(new Error(message))).toBe(false);
  });

  test.each([null, undefined, 'exit status 3', 42, {}, { message: 42 }])(
    'never throws and returns false for non-Error input %p',
    (value) => {
      expect(isAppNotRunning(value)).toBe(false);
    }
  );
});
