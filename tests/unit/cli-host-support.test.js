'use strict';

// #165: on a host the device session cannot run on (Windows), every verb that
// reaches the session layer must fail with an `environment` envelope BEFORE
// anything is spawned or connected. It used to surface as a `device` failure,
// which reads as "no phone connected" — the wrong problem to go debug.
// Device-free verbs must be untouched.

const os = require('os');
const fs = require('fs');
const path = require('path');

const { buildProgram } = require('../../src/cli');
const connection = require('../../src/device/connection');

const FIXTURE = path.join(__dirname, '..', 'integration', 'fixtures', 'scenario-valid.json');

function workspaceRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-165-'));
  fs.mkdirSync(path.join(root, 'mobile-automator'));
  fs.writeFileSync(
    path.join(root, 'mobile-automator', 'config.json'),
    JSON.stringify({ mode: 'platform-aware' })
  );
  return root;
}

// Emitters double: captures both the envelope path and the raw-content path
// (schema) without ending the test process.
async function run(deps, ...args) {
  const calls = [];
  const emitters = {
    emit: (r) => calls.push(r),
    emitRaw: (raw, exitKind) => calls.push({ raw, exitKind }),
    finish: () => {},
    setVerb: () => {},
    setRunId: () => {},
    setSessionId: () => {},
    getRunId: () => null,
    getVerb: () => null,
  };
  await buildProgram({ emitters, ...deps }).parseAsync(['node', 'mauto', ...args]);
  return calls;
}

function expectHostFailure(calls) {
  expect(calls).toHaveLength(1);
  expect(calls[0].exitKind).toBe('environment');
  expect(calls[0].envelope.ok).toBe(false);
  expect(calls[0].envelope.error.kind).toBe('environment');
  expect(calls[0].envelope.error.message).toContain('"win32"');
  expect(calls[0].envelope.hint).toMatch(/WSL2/);
}

describe('unsupported host guard (#165)', () => {
  let root;
  let spies;

  beforeEach(() => {
    root = workspaceRoot();
    // The session handlers reach connection.* directly (not via the bridge
    // factory), so spy on that seam to prove nothing was attempted.
    spies = ['isSessionAlive', 'startSession', 'sessionStatus', 'endSession'].map((name) =>
      jest.spyOn(connection, name).mockImplementation(async () => {
        throw new Error(`connection.${name} must not be called on an unsupported host`);
      })
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('platform: win32', () => {
    test.each([
      [['tap', '--at', '10,20']],
      [['elements']],
      [['devices']],
      [['devices', 'use', 'emulator-5554']],
    ])('%j fails environment without calling the bridge factory', async (argv) => {
      const factory = jest.fn();
      const calls = await run({ projectRoot: root, platform: 'win32', deviceBridgeFactory: factory }, ...argv);
      expectHostFailure(calls);
      expect(factory).not.toHaveBeenCalled();
    });

    test.each([
      [['session', 'start']],
      [['session', 'status']],
      [['session', 'end']],
    ])('%j fails environment without touching the session layer', async (argv) => {
      const factory = jest.fn();
      const calls = await run({ projectRoot: root, platform: 'win32', deviceBridgeFactory: factory }, ...argv);
      expectHostFailure(calls);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(factory).not.toHaveBeenCalled();
    });

    test('validate still succeeds', async () => {
      const calls = await run({ projectRoot: root, platform: 'win32' }, 'validate', FIXTURE);
      expect(calls).toHaveLength(1);
      expect(calls[0].exitKind).toBe('ok');
      expect(calls[0].envelope.ok).toBe(true);
    });

    test('schema scenario still succeeds', async () => {
      const calls = await run({ projectRoot: root, platform: 'win32' }, 'schema', 'scenario');
      expect(calls).toHaveLength(1);
      expect(calls[0].exitKind).toBe('ok');
    });

    test('devices clear still succeeds (it only edits the workspace)', async () => {
      // Its "is a daemon still serving the old pin?" probe finds none — the
      // same answer a host that cannot run one gives.
      spies[0].mockResolvedValue(false);
      const calls = await run({ projectRoot: root, platform: 'win32' }, 'devices', 'clear');
      expect(calls).toHaveLength(1);
      expect(calls[0].exitKind).toBe('ok');
    });
  });

  describe('platform: linux', () => {
    test('a device verb reaches the bridge factory', async () => {
      const factory = jest.fn(async () => ({
        bridge: { listDevices: async () => [] },
        close: async () => {},
      }));
      const calls = await run({ projectRoot: root, platform: 'linux', deviceBridgeFactory: factory }, 'devices');
      expect(factory).toHaveBeenCalledTimes(1);
      expect(calls[0].envelope.ok).toBe(true);
    });

    test('session status reaches the session layer', async () => {
      spies[2].mockImplementation(async () => ({ running: false }));
      const calls = await run({ projectRoot: root, platform: 'linux' }, 'session', 'status');
      expect(spies[2]).toHaveBeenCalledTimes(1);
      expect(calls[0].exitKind).toBe('ok');
    });
  });
});
