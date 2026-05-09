'use strict';

const fs = require('fs');
const path = require('path');
const { parseGeteventLine, GeteventStreamParser } = require('../../../tools/recorder/src/capture/adb-getevent');

const FIXTURES = path.resolve(__dirname, '../../fixtures/recorder/adb-getevent-streams');

describe('parseGeteventLine', () => {
  test('parses BACK key down', () => {
    const ev = parseGeteventLine('[   17236.789012] /dev/input/event0: EV_KEY       KEY_BACK             DOWN');
    expect(ev).toEqual({ t_seconds: 17236.789012, key: 'BACK', state: 'down' });
  });

  test('parses VOLUMEUP key up', () => {
    const ev = parseGeteventLine('[       3.456789] /dev/input/event4: EV_KEY       KEY_VOLUMEUP         UP');
    expect(ev).toEqual({ t_seconds: 3.456789, key: 'VOLUMEUP', state: 'up' });
  });

  test('parses HOME key down', () => {
    const ev = parseGeteventLine('[   17240.123456] /dev/input/event0: EV_KEY       KEY_HOMEPAGE         DOWN');
    expect(ev).toEqual({ t_seconds: 17240.123456, key: 'HOMEPAGE', state: 'down' });
  });

  test('returns null for non-key events', () => {
    expect(parseGeteventLine('[   17236.789012] /dev/input/event2: EV_ABS       ABS_MT_TRACKING_ID   00000a3f')).toBeNull();
  });

  test('returns null for malformed lines', () => {
    expect(parseGeteventLine('garbage')).toBeNull();
    expect(parseGeteventLine('')).toBeNull();
    expect(parseGeteventLine(null)).toBeNull();
    expect(parseGeteventLine(undefined)).toBeNull();
  });
});

describe('GeteventStreamParser', () => {
  test('emits one event per matched line from a fixture file', () => {
    const out = [];
    const parser = new GeteventStreamParser({ emit: (e) => out.push(e), tStart: 17236.789 });
    const fixture = fs.readFileSync(path.join(FIXTURES, 'back-press.txt'), 'utf8');
    parser.feedChunk(fixture);
    parser.end();
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ kind: 'key', key: 'BACK', state: 'down' });
    expect(out[1]).toMatchObject({ kind: 'key', key: 'BACK', state: 'up' });
  });

  test('translates timestamps relative to tStart in ms', () => {
    const out = [];
    const parser = new GeteventStreamParser({ emit: (e) => out.push(e), tStart: 17236.789 });
    const fixture = fs.readFileSync(path.join(FIXTURES, 'back-press.txt'), 'utf8');
    parser.feedChunk(fixture);
    parser.end();
    // BACK DOWN at 17236.789012 - 17236.789 = 0.012ms ≈ 0; BACK UP at +45.521ms ≈ 46
    expect(out[0].t).toBe(0);
    expect(out[1].t).toBe(46);
  });

  test('handles partial-line chunks across reads', () => {
    const out = [];
    const parser = new GeteventStreamParser({ emit: (e) => out.push(e), tStart: 0 });
    parser.feedChunk('[   17236.789012] /dev/input/event0: EV_KEY       KEY_BACK             DOWN\n[   17236.834');
    parser.feedChunk('521] /dev/input/event0: EV_KEY       KEY_BACK             UP\n');
    parser.end();
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ key: 'BACK', state: 'down' });
    expect(out[1]).toMatchObject({ key: 'BACK', state: 'up' });
  });

  test('flushes a trailing line missing a newline at end()', () => {
    const out = [];
    const parser = new GeteventStreamParser({ emit: (e) => out.push(e), tStart: 0 });
    parser.feedChunk('[   17236.789012] /dev/input/event0: EV_KEY       KEY_BACK             DOWN');
    expect(out).toHaveLength(0);
    parser.end();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: 'BACK', state: 'down' });
  });

  test('ignores interleaved EV_ABS / EV_SYN lines and emits only key events', () => {
    const out = [];
    const parser = new GeteventStreamParser({ emit: (e) => out.push(e), tStart: 0 });
    parser.feedChunk([
      '[       1.000000] /dev/input/event2: EV_ABS       ABS_MT_TRACKING_ID   00000a3f',
      '[       1.001000] /dev/input/event0: EV_KEY       KEY_BACK             DOWN',
      '[       1.002000] /dev/input/event2: EV_SYN       SYN_REPORT           00000000',
      '[       1.050000] /dev/input/event0: EV_KEY       KEY_BACK             UP',
      '',
    ].join('\n'));
    parser.end();
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.key)).toEqual(['BACK', 'BACK']);
  });
});
