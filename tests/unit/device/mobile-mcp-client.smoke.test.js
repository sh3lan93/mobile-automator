'use strict';

// Smoke test only — must NOT spawn mobile-mcp.
const mod = require('../../../src/device/mobile-mcp-client');

describe('mobile-mcp-client (smoke)', () => {
  test('module loads and exports createCall', () => {
    expect(typeof mod.createCall).toBe('function');
  });
});
