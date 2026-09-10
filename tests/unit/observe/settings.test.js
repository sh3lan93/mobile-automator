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

describe('resolveRunId', () => {
  const { resolveRunId } = require('../../../src/observe/settings');

  it('returns the exported run id', () => {
    expect(resolveRunId({ MAUTO_RUN_ID: 'run_20260905_141500' })).toBe('run_20260905_141500');
  });

  it('trims incidental whitespace from a shell export', () => {
    expect(resolveRunId({ MAUTO_RUN_ID: '  smoke \n' })).toBe('smoke');
  });

  it('returns null when unset, empty, blank or non-string', () => {
    expect(resolveRunId({})).toBeNull();
    expect(resolveRunId({ MAUTO_RUN_ID: '' })).toBeNull();
    expect(resolveRunId({ MAUTO_RUN_ID: '   ' })).toBeNull();
    expect(resolveRunId({ MAUTO_RUN_ID: 7 })).toBeNull();
    expect(resolveRunId()).toBeNull();
  });

  // Validation deliberately does NOT live here. resolveRunId answers "is there
  // a run id", runTracePath answers "can it name a file" — one gate, at the
  // point where the value becomes a path. A second predicate here could
  // disagree with that one, and the disagreement would be silent.
  it('does not validate — a hostile id is still returned, and refused downstream', () => {
    expect(resolveRunId({ MAUTO_RUN_ID: '../../etc' })).toBe('../../etc');
  });
});
