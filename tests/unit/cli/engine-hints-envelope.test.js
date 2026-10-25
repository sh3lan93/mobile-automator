'use strict';

// Every device-failure path in cli.js must route its hint through
// engineHint (#199): a failed iOS-agent auto-install (1.0.13, #248) and the
// changed-device-id failure otherwise surface as the generic "Ensure a device
// … is connected".

const {
  handleElements,
  handleScreenshot,
  handleTap,
  handleDevices,
  handleDevicesUse,
  handleCrashList,
} = require('../../../src/cli');

const fs = require('fs');
const path = require('path');

// The mobilecli the pinned mobile-mcp spawns — the version the hint must name.
const MOBILECLI_VERSION = JSON.parse(
  fs.readFileSync(
    require.resolve('mobilecli/package.json', {
      paths: [path.dirname(require.resolve('@mobilenext/mobile-mcp/package.json'))],
    }),
    'utf8'
  )
).version;

// The REAL failed automatic agent install captured against mobile-mcp 1.0.13
// (#248) — before this fix mauto answered it with the generic hint.
const B1_MESSAGE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'fixtures', 'device', 'mobile-mcp-1.0.13', 'ios-sim.agent-install-failed.txt'),
  'utf8'
);
const B2_MESSAGE =
  'Device "emulator-5554" not found. Use the mobile_list_available_devices tool to see available devices.. Please fix the issue and try again.';

const throwing = (message, extra = {}) => async () => {
  const err = new Error(message);
  Object.assign(err, extra);
  throw err;
};

describe('device-failure envelopes carry the engine hint', () => {
  it('a device verb (elements) gets the missing-agent install command', async () => {
    const { envelope, exitKind } = await handleElements({ deviceBridge: { listElements: throwing(B1_MESSAGE) } });
    expect(exitKind).toBe('device');
    expect(envelope.error.message).toBe(B1_MESSAGE);
    expect(envelope.hint).toContain(
      `npx -y mobilecli@${MOBILECLI_VERSION} agent install --device C6C6FFB9-7382-456B-9EE8-0047C8EEA80B`
    );
    expect(envelope.hint).toMatch(/normally installs it automatically/);
    expect(envelope.hint).not.toMatch(/cannot install/);
  });

  it('a verb routed through deviceFail (tap) gets the changed-device-id hint', async () => {
    const { envelope, exitKind } = await handleTap({ deviceBridge: { tap: throwing(B2_MESSAGE) } }, '1,2');
    expect(exitKind).toBe('device');
    expect(envelope.hint).toContain('"emulator-5554"');
    expect(envelope.hint).toContain('`mauto devices use');
  });

  it('screenshot (its own fail call) gets the engine hint', async () => {
    const { envelope } = await handleScreenshot({ deviceBridge: { screenshot: throwing(B1_MESSAGE) } }, '/tmp/x.png');
    expect(envelope.hint).toMatch(/agent install --device C6C6FFB9/);
  });

  it('screenshot outside the allowed directories gets the project-root hint (#214)', async () => {
    const msg =
      '"/elsewhere" is not in the list of allowed directories. Allowed directories include ' +
      'the current directory and the temp directory on this host.';
    const { envelope, exitKind } = await handleScreenshot(
      { deviceBridge: { screenshot: throwing(msg) } },
      '/elsewhere/x.png'
    );
    expect(exitKind).toBe('device');
    expect(envelope.hint).toContain('project root');
  });

  it('devices, devices use and crash list get the engine hint too', async () => {
    const bridge = { listDevices: throwing(B2_MESSAGE), listCrashes: throwing(B1_MESSAGE) };
    expect((await handleDevices({ deviceBridge: bridge })).envelope.hint).toContain('"emulator-5554"');
    expect((await handleDevicesUse({ deviceBridge: bridge }, 'emulator-5554')).envelope.hint).toContain('"emulator-5554"');
    expect((await handleCrashList({ deviceBridge: bridge, projectRoot: require('os').tmpdir() })).envelope.hint)
      .toMatch(/agent install/);
  });

  it('an explicit err.hint from our own code still wins', async () => {
    const { envelope } = await handleTap(
      { deviceBridge: { tap: throwing(B2_MESSAGE, { hint: 'our specific hint' }) } },
      '1,2'
    );
    expect(envelope.hint).toBe('our specific hint');
  });
});

describe('unrelated device failures keep their existing hints byte-identical', () => {
  const plain = { listElements: throwing('boom'), tap: throwing('boom'), screenshot: throwing('boom'), listDevices: throwing('boom') };

  it('elements / tap / screenshot / devices', async () => {
    expect((await handleElements({ deviceBridge: plain })).envelope.hint)
      .toBe('Ensure a device or simulator is connected and the app is running.');
    expect((await handleTap({ deviceBridge: plain }, '1,2')).envelope.hint)
      .toBe('Ensure a device or simulator is connected and the app is running.');
    expect((await handleScreenshot({ deviceBridge: plain }, '/tmp/x.png')).envelope.hint)
      .toBe('Ensure a device or simulator is connected.');
    expect((await handleDevices({ deviceBridge: plain })).envelope.hint)
      .toBe('Ensure a device or simulator is connected and reachable.');
  });
});
