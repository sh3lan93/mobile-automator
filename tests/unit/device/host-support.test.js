'use strict';

const pkg = require('../../../package.json');
const {
  SUPPORTED_HOSTS,
  isSupportedHost,
  unsupportedHostError,
} = require('../../../src/device/host-support');

// #165: the device session is POSIX-only (Unix socket, `ps`, process-group
// kill). package.json `os` is the single source of truth for which hosts that
// covers; the runtime guard must agree with it rather than restate it.

describe('host-support (#165)', () => {
  test('SUPPORTED_HOSTS mirrors package.json os, and is frozen', () => {
    expect(SUPPORTED_HOSTS).toEqual(pkg.os);
    expect(Object.isFrozen(SUPPORTED_HOSTS)).toBe(true);
  });

  test.each(['darwin', 'linux'])('%s is supported', (platform) => {
    expect(isSupportedHost(platform)).toBe(true);
  });

  test.each(['win32', 'freebsd', 'aix'])('%s is not supported', (platform) => {
    expect(isSupportedHost(platform)).toBe(false);
  });

  test('defaults to process.platform', () => {
    expect(isSupportedHost()).toBe(SUPPORTED_HOSTS.includes(process.platform));
  });

  test('unsupportedHostError is an environment error naming the platform', () => {
    const err = unsupportedHostError('win32');
    expect(err).toBeInstanceOf(Error);
    expect(err.kind).toBe('environment');
    expect(err.message).toContain('"win32"');
    expect(err.message).toMatch(/macOS/);
    expect(err.message).toMatch(/Linux/);
  });

  test('the hint points Windows users at WSL2 and the troubleshooting entry', () => {
    const { hint } = unsupportedHostError('win32');
    expect(hint).toMatch(/WSL2/);
    expect(hint).toContain('TROUBLESHOOTING.md');
    expect(hint).toContain('mauto refuses to run on Windows');
  });
});
