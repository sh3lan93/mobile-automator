'use strict';

const { resolveLevels, atLeast } = require('../../../src/observe/settings');

describe('resolveLevels', () => {
  it('defaults to warn on stderr and info in the file', () => {
    expect(resolveLevels({})).toEqual({ stderr: 'warn', file: 'info' });
  });

  it('applies an explicit level to both sinks', () => {
    expect(resolveLevels({ MAUTO_LOG_LEVEL: 'debug' })).toEqual({ stderr: 'debug', file: 'debug' });
  });

  it('is case-insensitive', () => {
    expect(resolveLevels({ MAUTO_LOG_LEVEL: 'DEBUG' })).toEqual({ stderr: 'debug', file: 'debug' });
  });

  it('silences both sinks on silent', () => {
    expect(resolveLevels({ MAUTO_LOG_LEVEL: 'silent' })).toEqual({ stderr: null, file: null });
  });

  it('falls back to the default on an unrecognised value rather than throwing', () => {
    expect(resolveLevels({ MAUTO_LOG_LEVEL: 'chatty' })).toEqual({ stderr: 'warn', file: 'info' });
  });
});

describe('atLeast', () => {
  it('passes an event at or above the threshold', () => {
    expect(atLeast('error', 'warn')).toBe(true);
    expect(atLeast('warn', 'warn')).toBe(true);
  });

  it('rejects an event below the threshold', () => {
    expect(atLeast('debug', 'info')).toBe(false);
  });

  it('rejects everything when the threshold is null', () => {
    expect(atLeast('error', null)).toBe(false);
  });
});
