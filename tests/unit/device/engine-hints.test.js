'use strict';

const fs = require('fs');
const path = require('path');
const { engineHint } = require('../../../src/device/engine-hints');

// A REAL failed automatic agent install on an iOS simulator, captured through
// the shipped CLI against mobile-mcp 1.0.13 (#248): the engine runs `agent
// install` itself and execFileSync rethrows the command + stderr. Paths are
// sanitized; the text is otherwise verbatim.
const B1_MESSAGE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'fixtures', 'device', 'mobile-mcp-1.0.13', 'ios-sim.agent-install-failed.txt'),
  'utf8'
);

// mobile-mcp 1.0.5's message (#199). 1.0.13 catches `agent status`'s exit
// itself and auto-installs, so this can no longer reach mauto from the pinned
// engine — it must not trigger the hint.
const LEGACY_1_0_5_MESSAGE =
  'Error: Command failed: /Users/me/proj/node_modules/mobilecli/bin/mobilecli-darwin-arm64 ' +
  'agent status --device C6C6FFB9-7382-456B-9EE8-0047C8EEA80B\n' +
  'Agent is not installed on the device\n';

// The engine's own not-found text when an id from the other robot is used.
const B2_MESSAGE =
  'Device "emulator-5554" not found. Use the mobile_list_available_devices tool ' +
  'to see available devices.. Please fix the issue and try again.';

const MCP_TOOL = /\bmobile_[a-z_]+/;
const TEMPLATE_TOKEN = /\{\{|<device-id>|<udid>/;

describe('engineHint — missing iOS DeviceKit agent', () => {
  const version = () => '1.0.13';

  it('names the one-time install command with the UDID from the message', () => {
    const hint = engineHint(B1_MESSAGE, { mobilecliVersion: version });
    expect(hint).toContain(
      'npx -y mobilecli@1.0.13 agent install --device C6C6FFB9-7382-456B-9EE8-0047C8EEA80B'
    );
  });

  // mobile-mcp 1.0.11+ installs the simulator agent itself (mobile-mcp#459 is
  // fixed), so the hint must not claim it cannot — it only fires when that
  // automatic install failed.
  it('says the automatic install failed rather than that the engine cannot install it', () => {
    const hint = engineHint(B1_MESSAGE, { mobilecliVersion: version });
    expect(hint).toMatch(/normally installs it automatically/);
    expect(hint).toMatch(/that install failed/);
    expect(hint).toMatch(/needs network/);
    expect(hint).not.toMatch(/cannot install/);
    expect(hint).not.toContain('mobile-mcp/issues/459');
  });

  it('does not fire for a message without the failed `agent install --device <udid>` shape', () => {
    for (const msg of [
      LEGACY_1_0_5_MESSAGE,
      'Agent is not installed on the device',
      'failed to install agent: offline',
      'Error: Command failed: /x/mobilecli agent status --device C6C6FFB9-7382-456B-9EE8-0047C8EEA80B',
    ]) {
      expect(engineHint(msg, { mobilecliVersion: version })).toBeNull();
    }
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
    expect(hint).toContain('emulator-5554');
    // #251: the workspace `engine` key is the primary control...
    expect(hint).toContain('`mauto config get engine`');
    expect(hint).toContain('`mauto config set engine <mobilecli|legacy>`');
    // ...and an exported variable still overrides it.
    expect(hint).toContain('MOBILEMCP_LEGACY_ROBOT');
    expect(hint).toMatch(/MOBILEMCP_LEGACY_ROBOT[^.]*overrides/);
    expect(hint).toContain('`mauto devices`');
    expect(hint).toContain('`mauto devices use');
    expect(hint).toContain('--device');
  });
});

// mobile-mcp 1.0.5 validateOutputPath's rejection. Its "current directory" is
// the engine's cwd — the project root since #214 — which the user cannot see.
const B3_MESSAGE =
  '"/Users/me/elsewhere" is not in the list of allowed directories. Allowed directories ' +
  'include the current directory and the temp directory on this host.';

describe('engineHint — screenshot path outside the allowed directories (#214)', () => {
  it('names the project root and the temp directory instead of "the current directory"', () => {
    const hint = engineHint(B3_MESSAGE);
    expect(hint).toContain('project root');
    expect(hint).toContain('mobile-automator/');
    expect(hint).toContain('temp directory');
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
    for (const msg of [B1_MESSAGE, B2_MESSAGE, B3_MESSAGE]) {
      const hint = engineHint(msg, { mobilecliVersion: () => '1.0.13' });
      expect(hint).not.toMatch(MCP_TOOL);
      expect(hint).not.toMatch(TEMPLATE_TOKEN);
    }
  });
});
