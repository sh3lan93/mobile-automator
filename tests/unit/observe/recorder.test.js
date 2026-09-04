'use strict';

const { record, defaultSinks } = require('../../../src/observe/recorder');

// A sink is a { threshold, write } pair — production builds them in
// defaultSinks() and they always carry a threshold, so tests state one too.
// Nothing in record() invents one on a sink's behalf.
function collector(threshold = 'debug') {
  const seen = [];
  return { threshold, seen, write: (e) => seen.push(e) };
}

// The REAL default sinks with only their `write` swapped out. Level-filtering
// tests use this rather than hand-rolled thresholds so they exercise the
// thresholds production actually resolves — including the deliberate asymmetry
// between the two sinks — instead of re-stating resolveLevels() in the test.
function spyDefaults(env) {
  const seen = [];
  const sinks = defaultSinks('/unused', env).map((sink) => ({
    ...sink,
    write: (e) => seen.push({ threshold: sink.threshold, event: e }),
  }));
  return { seen, sinks };
}

describe('record', () => {
  it('fans an event out to every sink', () => {
    const a = collector();
    const b = collector();
    record({ level: 'error', event: 'verb.end', verb: 'tap' }, { sinks: [a, b], env: {} });
    expect(a.seen).toHaveLength(1);
    expect(b.seen).toHaveLength(1);
    expect(a.seen[0].verb).toBe('tap');
  });

  it('stamps the ambient fields via makeEvent', () => {
    const a = collector();
    record({ level: 'error', event: 'verb.end' }, { sinks: [a], env: {} });
    expect(a.seen[0].v).toBe(1);
    expect(typeof a.seen[0].ts).toBe('string');
  });

  it('defaults an event with no level to info', () => {
    const a = collector();
    record({ event: 'plain' }, { sinks: [a], env: {} });
    expect(a.seen[0].level).toBe('info');
  });

  describe('level filtering against the sinks the CLI really builds', () => {
    it('drops a debug event at the default levels', () => {
      const { seen, sinks } = spyDefaults({});
      record({ level: 'debug', event: 'noisy' }, { sinks, env: {} });
      expect(seen).toHaveLength(0);
    });

    it('sends an info event to the file sink but not to stderr', () => {
      // The asymmetry is the point: stderr is a human's channel during an
      // interactive run (warn), the file is a forensic record (info).
      const { seen, sinks } = spyDefaults({});
      record({ level: 'info', event: 'verb.end' }, { sinks, env: {} });
      expect(seen.map((s) => s.threshold)).toEqual(['info']);
    });

    it('sends a warn event to both', () => {
      const { seen, sinks } = spyDefaults({});
      record({ level: 'warn', event: 'verb.end' }, { sinks, env: {} });
      expect(seen).toHaveLength(2);
    });

    it('passes a debug event through when MAUTO_LOG_LEVEL=debug', () => {
      const { seen, sinks } = spyDefaults({ MAUTO_LOG_LEVEL: 'debug' });
      record({ level: 'debug', event: 'noisy' }, { sinks, env: { MAUTO_LOG_LEVEL: 'debug' } });
      expect(seen).toHaveLength(2);
    });

    it('drops everything when MAUTO_LOG_LEVEL=silent', () => {
      const { seen, sinks } = spyDefaults({ MAUTO_LOG_LEVEL: 'silent' });
      record({ level: 'error', event: 'boom' }, { sinks, env: { MAUTO_LOG_LEVEL: 'silent' } });
      expect(seen).toHaveLength(0);
    });

    it('does not invent a threshold for a sink that carries none', () => {
      // The contract is "a sink states its own threshold". A recorder that
      // filled one in would be carrying a branch no production sink can reach.
      const thresholdless = { write: jest.fn() };
      record({ level: 'error', event: 'e' }, { sinks: [thresholdless], env: {} });
      expect(thresholdless.write).not.toHaveBeenCalled();
    });
  });

  it('isolates a throwing sink so its neighbour still receives the event', () => {
    const bad = { threshold: 'debug', write() { throw new Error('sink exploded'); } };
    const good = collector();
    expect(() =>
      record({ level: 'error', event: 'e' }, { sinks: [bad, good], env: {} })
    ).not.toThrow();
    expect(good.seen).toHaveLength(1);
  });

  it('never throws even when the event itself is hostile', () => {
    const cyclic = { level: 'error', event: 'e' };
    cyclic.self = cyclic;
    expect(() => record(cyclic, { sinks: [], env: {} })).not.toThrow();
  });
});

describe('defaultSinks', () => {
  it('gives every sink a threshold, so record() never has to fill one in', () => {
    for (const sink of defaultSinks('/unused', {})) {
      expect(typeof sink.threshold).toBe('string');
    }
  });

  it('turns both sinks off at MAUTO_LOG_LEVEL=silent', () => {
    for (const sink of defaultSinks('/unused', { MAUTO_LOG_LEVEL: 'silent' })) {
      expect(sink.threshold).toBeNull();
    }
  });
});
