'use strict';

const { engineHint } = require('../../../src/device/engine-hints');

// The exact text the #199 real-device run (T8) got back from mobile-mcp 1.0.5
// on an iOS simulator without the DeviceKit agent: mobilecli's `agent status`
// exits 1 and mobile-mcp's execFileSync rethrows the whole command + stderr.
const B1_MESSAGE =
  'Error: Command failed: /Users/me/proj/node_modules/mobilecli/bin/mobilecli-darwin-arm64 ' +
  'agent status --device C6C6FFB9-7382-456B-9EE8-0047C8EEA80B\n' +
  'Agent is not installed on the device\n';

// The engine's own not-found text when an id from the other robot is used.
const B2_MESSAGE =
  'Device "emulator-5554" not found. Use the mobile_list_available_devices tool ' +
  'to see available devices.. Please fix the issue and try again.';

const MCP_TOOL = /\bmobile_[a-z_]+/;
const TEMPLATE_TOKEN = /\{\{|<device-id>|<udid>/;

describe('engineHint — missing iOS DeviceKit agent (mobile-mcp#459)', () => {
  const version = () => '1.0.13';

  it('names the one-time install command with the UDID from the message', () => {
    const hint = engineHint(B1_MESSAGE, { mobilecliVersion: version });
    expect(hint).toContain(
      'npx -y mobilecli@1.0.13 agent install --device C6C6FFB9-7382-456B-9EE8-0047C8EEA80B'
    );
    expect(hint).toContain('https://github.com/mobile-next/mobile-mcp/issues/459');
  });

  it('without a --device in the message, points at `mauto devices` instead of a template token', () => {
    const hint = engineHint('Agent is not installed on the device', { mobilecliVersion: version });
    expect(hint).toContain('npx -y mobilecli@1.0.13 agent install --device');
    expect(hint).toContain('`mauto devices`');
    expect(hint).not.toMatch(TEMPLATE_TOKEN);
  });

  it('omits @<version> when mobilecli cannot be resolved', () => {
    const hint = engineHint(B1_MESSAGE, { mobilecliVersion: () => null });
    expect(hint).toContain('npx -y mobilecli agent install --device C6C6FFB9-7382-456B-9EE8-0047C8EEA80B');
    expect(hint).not.toMatch(/mobilecli@/);
  });

  it('never throws when the version resolver throws', () => {
    const boom = () => {
      throw new Error('Cannot find module mobilecli/package.json');
    };
    let hint;
    expect(() => {
      hint = engineHint(B1_MESSAGE, { mobilecliVersion: boom });
    }).not.toThrow();
    expect(hint).toContain('npx -y mobilecli agent install');
  });

  it('by default resolves the version of the mobilecli the pinned mobile-mcp uses', () => {
    const path = require('path');
    const mcpDir = path.dirname(require.resolve('@mobilenext/mobile-mcp/package.json'));
    const expected = require(require.resolve('mobilecli/package.json', { paths: [mcpDir] })).version;
    expect(engineHint(B1_MESSAGE)).toContain(`npx -y mobilecli@${expected} agent install`);
  });
});

describe('engineHint — device id not found (ids differ between engines)', () => {
  it('quotes the id back and explains AVD name vs adb serial', () => {
    const hint = engineHint(B2_MESSAGE);
    expect(hint).toContain('"emulator-5554"');
    expect(hint).toContain('Pixel_9_Pro');
    expect(hint).toContain('MOBILEMCP_LEGACY_ROBOT=1');
    expect(hint).toContain('`mauto devices`');
    expect(hint).toContain('`mauto devices use');
    expect(hint).toContain('--device');
  });
});

describe('engineHint — hygiene', () => {
  it('returns null for an unrelated message', () => {
    expect(engineHint('no device connected')).toBeNull();
    expect(engineHint('')).toBeNull();
  });

  it('never throws on non-string input', () => {
    expect(engineHint(undefined)).toBeNull();
    expect(engineHint(null)).toBeNull();
    expect(engineHint({})).toBeNull();
  });

  it('never names a raw mobile-mcp tool or leaves a template token', () => {
    for (const msg of [B1_MESSAGE, B2_MESSAGE, 'Agent is not installed on the device']) {
      const hint = engineHint(msg, { mobilecliVersion: () => '1.0.13' });
      expect(hint).not.toMatch(MCP_TOOL);
      expect(hint).not.toMatch(TEMPLATE_TOKEN);
    }
  });
});
