'use strict';

const { record } = require('../../../src/observe/recorder');

function collector() {
  const seen = [];
  return { seen, write: (e) => seen.push(e) };
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

  it('drops an event below the resolved threshold', () => {
    const a = collector();
    // Default stderr threshold is warn, so a debug event must not reach it.
    record({ level: 'debug', event: 'noisy' }, { sinks: [a], env: {} });
    expect(a.seen).toHaveLength(0);
  });

  it('passes a debug event through when MAUTO_LOG_LEVEL=debug', () => {
    const a = collector();
    record({ level: 'debug', event: 'noisy' }, { sinks: [a], env: { MAUTO_LOG_LEVEL: 'debug' } });
    expect(a.seen).toHaveLength(1);
  });

  it('drops everything when MAUTO_LOG_LEVEL=silent', () => {
    const a = collector();
    record({ level: 'error', event: 'boom' }, { sinks: [a], env: { MAUTO_LOG_LEVEL: 'silent' } });
    expect(a.seen).toHaveLength(0);
  });

  it('defaults an event with no level to info', () => {
    const a = collector();
    record({ event: 'plain' }, { sinks: [a], env: { MAUTO_LOG_LEVEL: 'info' } });
    expect(a.seen[0].level).toBe('info');
  });

  it('isolates a throwing sink so its neighbour still receives the event', () => {
    const bad = { write() { throw new Error('sink exploded'); } };
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
