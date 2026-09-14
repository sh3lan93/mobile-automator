'use strict';

const { normalizeCrashes, crashTimestampMs } = require('../../../src/device/crash-model');

describe('normalizeCrashes', () => {
  it('accepts a bare array of descriptors', () => {
    expect(
      normalizeCrashes([{ id: 'r1', processName: 'com.acme.app', timestamp: '2026-09-05T10:00:00Z' }])
    ).toEqual([{ id: 'r1', process: 'com.acme.app', timestamp: '2026-09-05T10:00:00Z' }]);
  });

  it('accepts a { crashes: [...] } envelope', () => {
    expect(normalizeCrashes({ crashes: [{ id: 'r1' }] })).toEqual([
      { id: 'r1', process: null, timestamp: null },
    ]);
  });

  it('accepts a JSON string, because the engine stringifies its payload', () => {
    // mobile-mcp's mobile_list_crashes returns JSON.stringify(response.data);
    // parseToolResult usually parses it, but a text/JSON fallback can leave it
    // a string, and a normalizer that only handles the happy shape is how a
    // silently-empty list happens.
    expect(normalizeCrashes('[{"id":"r1"}]')).toEqual([
      { id: 'r1', process: null, timestamp: null },
    ]);
  });

  it('tolerates the key spellings a separately-versioned engine may use', () => {
    expect(
      normalizeCrashes([{ crashId: 'r9', bundleId: 'com.acme.app', date: '2026-09-05T10:00:00Z' }])
    ).toEqual([{ id: 'r9', process: 'com.acme.app', timestamp: '2026-09-05T10:00:00Z' }]);
  });

  it('never invents a field it could not read', () => {
    expect(normalizeCrashes([{ nothing: 'useful' }])).toEqual([
      { id: null, process: null, timestamp: null },
    ]);
  });

  it('returns an empty array for anything unreadable rather than throwing', () => {
    for (const raw of [null, undefined, 42, 'not json', {}, [null], [3]]) {
      expect(Array.isArray(normalizeCrashes(raw))).toBe(true);
    }
    expect(normalizeCrashes(null)).toEqual([]);
    expect(normalizeCrashes([null, 3])).toEqual([]);
  });
});

describe('crashTimestampMs', () => {
  it('parses an ISO timestamp', () => {
    expect(crashTimestampMs({ timestamp: '2026-09-05T10:00:00.000Z' })).toBe(
      Date.parse('2026-09-05T10:00:00.000Z')
    );
  });

  it('parses epoch seconds and epoch milliseconds', () => {
    expect(crashTimestampMs({ timestamp: 1788000000 })).toBe(1788000000 * 1000);
    expect(crashTimestampMs({ timestamp: 1788000000000 })).toBe(1788000000000);
  });

  it('returns null — never 0, never NaN — when the time is unreadable', () => {
    // 0 would compare as "before every watermark" and silently drop the report;
    // NaN would compare false against everything and silently drop it too. Both
    // are the confident-wrong-answer failure this slice exists to prevent, so
    // an unreadable time is reported as unattributed instead.
    expect(crashTimestampMs({ timestamp: null })).toBeNull();
    expect(crashTimestampMs({ timestamp: 'yesterday-ish' })).toBeNull();
    expect(crashTimestampMs({})).toBeNull();
    expect(crashTimestampMs(null)).toBeNull();
  });

  it('returns null for an at-or-before-epoch instant, however it is spelled', () => {
    // No device capable of running mauto reports a crash at or before the Unix
    // epoch, so every spelling of "the engine could not determine a time" that
    // decodes to <= 0 is a sentinel, not a real instant — a wire-format detail,
    // not a fact about the crash. Concretely: a zero-value int64 epoch field
    // (`0`, `'0'`) and Go's zero-value time.Time (`'0001-01-01T00:00:00Z'`,
    // which json.Marshal emits for an unset time.Time) both decode to instants
    // at or before 1970-01-01T00:00:00Z. All three must read as unreadable —
    // never as a real, ancient instant — or Task 5 sorts them before every
    // watermark and silently drops the report instead of counting it in
    // `unattributed`.
    expect(crashTimestampMs({ timestamp: 0 })).toBeNull();
    expect(crashTimestampMs({ timestamp: '0' })).toBeNull();
    expect(crashTimestampMs({ timestamp: '0001-01-01T00:00:00Z' })).toBeNull();
  });
});
