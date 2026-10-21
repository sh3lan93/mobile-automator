'use strict';
const { buildEngineEnv } = require('../../../src/device/mobile-mcp-client');

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
