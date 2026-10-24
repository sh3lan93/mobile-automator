'use strict';
const { buildEngineEnv } = require('../../../src/device/mobile-mcp-client');
const path = require('path');

describe('buildEngineEnv (#212)', () => {
  test('defaults MOBILEMCP_ALLOW_UNSAFE_URLS to "1" when unset', () => {
    const env = buildEngineEnv({ baseEnv: { PATH: '/bin' } });
    expect(env.MOBILEMCP_ALLOW_UNSAFE_URLS).toBe('1');
  });

  test('preserves a user-set "0" so the upstream guard can be restored', () => {
    const env = buildEngineEnv({ baseEnv: { MOBILEMCP_ALLOW_UNSAFE_URLS: '0' } });
    expect(env.MOBILEMCP_ALLOW_UNSAFE_URLS).toBe('0');
  });

  test('preserves any other explicit value verbatim', () => {
    const env = buildEngineEnv({ baseEnv: { MOBILEMCP_ALLOW_UNSAFE_URLS: 'false' } });
    expect(env.MOBILEMCP_ALLOW_UNSAFE_URLS).toBe('false');
  });

  test('adds MOBILE_MCP_DEVICE when a device is given', () => {
    const env = buildEngineEnv({ device: 'emulator-5554', baseEnv: {} });
    expect(env.MOBILE_MCP_DEVICE).toBe('emulator-5554');
  });

  test('omits MOBILE_MCP_DEVICE when no device is given', () => {
    expect(buildEngineEnv({ baseEnv: {} })).not.toHaveProperty('MOBILE_MCP_DEVICE');
    expect(buildEngineEnv({ device: null, baseEnv: {} })).not.toHaveProperty('MOBILE_MCP_DEVICE');
  });

  test('carries through other baseEnv keys', () => {
    const env = buildEngineEnv({ baseEnv: { PATH: '/bin', HOME: '/h', MOBILE_MCP_EXTRA: 'x' } });
    expect(env).toMatchObject({ PATH: '/bin', HOME: '/h', MOBILE_MCP_EXTRA: 'x' });
  });

  test('does not mutate baseEnv and returns a distinct object', () => {
    const baseEnv = { PATH: '/bin' };
    const snapshot = { ...baseEnv };
    const env = buildEngineEnv({ device: 'd1', baseEnv });
    expect(env).not.toBe(baseEnv);
    expect(baseEnv).toEqual(snapshot);
  });

  test('defaults baseEnv to process.env', () => {
    const env = buildEngineEnv();
    expect(env).not.toBe(process.env);
    expect(env.PATH).toBe(process.env.PATH);
  });

  // #251: the `engine` config key selects mobile-mcp's legacy robot.
  describe('engine', () => {
    test('legacy sets MOBILEMCP_LEGACY_ROBOT=1 when unset', () => {
      expect(buildEngineEnv({ engine: 'legacy', baseEnv: {} }).MOBILEMCP_LEGACY_ROBOT).toBe('1');
    });

    test('mobilecli (or no engine) leaves MOBILEMCP_LEGACY_ROBOT unset', () => {
      expect(buildEngineEnv({ engine: 'mobilecli', baseEnv: {} })).not.toHaveProperty('MOBILEMCP_LEGACY_ROBOT');
      expect(buildEngineEnv({ baseEnv: {} })).not.toHaveProperty('MOBILEMCP_LEGACY_ROBOT');
    });

    test('a user-set MOBILEMCP_LEGACY_ROBOT always wins', () => {
      expect(buildEngineEnv({ engine: 'legacy', baseEnv: { MOBILEMCP_LEGACY_ROBOT: '0' } }).MOBILEMCP_LEGACY_ROBOT).toBe('0');
      expect(buildEngineEnv({ engine: 'mobilecli', baseEnv: { MOBILEMCP_LEGACY_ROBOT: '1' } }).MOBILEMCP_LEGACY_ROBOT).toBe('1');
    });
  });
});

describe('buildEngineEnv engine telemetry (#213)', () => {
  test('defaults MOBILEMCP_DISABLE_TELEMETRY to "1" when unset', () => {
    const env = buildEngineEnv({ baseEnv: { PATH: '/bin' } });
    expect(env.MOBILEMCP_DISABLE_TELEMETRY).toBe('1');
  });

  test('preserves a user-set value verbatim', () => {
    const env = buildEngineEnv({ baseEnv: { MOBILEMCP_DISABLE_TELEMETRY: 'yes' } });
    expect(env.MOBILEMCP_DISABLE_TELEMETRY).toBe('yes');
  });

  test('preserves a user-set empty string, the engine opt-in', () => {
    const env = buildEngineEnv({ baseEnv: { MOBILEMCP_DISABLE_TELEMETRY: '' } });
    expect(env.MOBILEMCP_DISABLE_TELEMETRY).toBe('');
  });

  test('MAUTO_TELEMETRY=0 overrides an engine opt-in', () => {
    const env = buildEngineEnv({ baseEnv: { MAUTO_TELEMETRY: '0', MOBILEMCP_DISABLE_TELEMETRY: '' } });
    expect(env.MOBILEMCP_DISABLE_TELEMETRY).toBe('1');
  });

  test('DO_NOT_TRACK=1 overrides an engine opt-in', () => {
    const env = buildEngineEnv({ baseEnv: { DO_NOT_TRACK: '1', MOBILEMCP_DISABLE_TELEMETRY: '' } });
    expect(env.MOBILEMCP_DISABLE_TELEMETRY).toBe('1');
  });
});

// #236: mobile-mcp runs mobilecli by the absolute path it resolves, so an
// in-project install put the project path on mobilecli's `ps` line. Given the
// workspace root, buildEngineEnv hands the engine a root-relative
// MOBILECLI_PATH; the engine runs with cwd = root and spawns mobilecli without
// a cwd of its own, so the relative path resolves to the same binary.
describe('buildEngineEnv MOBILECLI_PATH (#236)', () => {
  const root = '/a/proj';
  const inRoot = '/a/proj/node_modules/@mobilenext/mobilecli-darwin-arm64/bin/mobilecli';

  test('an in-root binary is passed relative to the root', () => {
    const env = buildEngineEnv({ baseEnv: {}, projectRoot: root, resolveMobilecli: () => inRoot });
    expect(env.MOBILECLI_PATH).toBe(
      path.join('node_modules', '@mobilenext', 'mobilecli-darwin-arm64', 'bin', 'mobilecli')
    );
    expect(env.MOBILECLI_PATH).not.toContain(root);
  });

  test('a binary outside the root (a global install) stays absolute', () => {
    const outside = '/usr/local/lib/node_modules/mobile-automator/node_modules/x/mobilecli';
    const env = buildEngineEnv({ baseEnv: {}, projectRoot: root, resolveMobilecli: () => outside });
    expect(env.MOBILECLI_PATH).toBe(outside);
  });

  test('a binary directly in the root keeps a separator, so it is never a PATH lookup', () => {
    const env = buildEngineEnv({ baseEnv: {}, projectRoot: root, resolveMobilecli: () => '/a/proj/mobilecli' });
    expect(env.MOBILECLI_PATH).toBe(`.${path.sep}mobilecli`);
  });

  test('a user-set MOBILECLI_PATH always wins', () => {
    const resolveMobilecli = jest.fn(() => inRoot);
    const env = buildEngineEnv({ baseEnv: { MOBILECLI_PATH: '/opt/mobilecli' }, projectRoot: root, resolveMobilecli });
    expect(env.MOBILECLI_PATH).toBe('/opt/mobilecli');
    expect(resolveMobilecli).not.toHaveBeenCalled();
  });

  test('a throwing resolver leaves it unset, so mobile-mcp reports its own error', () => {
    const env = buildEngineEnv({
      baseEnv: {},
      projectRoot: root,
      resolveMobilecli: () => {
        throw new Error('not found');
      },
    });
    expect(env).not.toHaveProperty('MOBILECLI_PATH');
  });

  test('no projectRoot: no MOBILECLI_PATH key, and the resolver is never asked', () => {
    const resolveMobilecli = jest.fn(() => inRoot);
    expect(buildEngineEnv({ baseEnv: {}, resolveMobilecli })).not.toHaveProperty('MOBILECLI_PATH');
    expect(resolveMobilecli).not.toHaveBeenCalled();
  });
});
