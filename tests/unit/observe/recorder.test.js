'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { record, defaultSinks, boundRecorder, safeObserve } = require('../../../src/observe/recorder');

// A project that HAS run `mauto setup` — the file sink refuses to log into a
// directory with no mobile-automator/ in it, so a real-fs test needs one.
function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-bound-rec-'));
  fs.mkdirSync(path.join(root, 'mobile-automator'), { recursive: true });
  return root;
}

function readLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

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

// The ONE never-load-bearing mechanism, exported so every boundary that injects
// a sink shares it instead of hand-rolling a try/catch of its own. It lives with
// the seam it guards: a guarantee you have to remember to re-apply at each call
// site is not a guarantee.
describe('safeObserve', () => {
  it('swallows a throwing observe instead of propagating into the caller', () => {
    const guarded = safeObserve(() => {
      throw new Error('observe exploded');
    });
    expect(() => guarded({ level: 'error', event: 'daemon.crash' })).not.toThrow();
  });

  it('passes fields straight through when the observe does not throw', () => {
    const seen = [];
    const guarded = safeObserve((fields) => seen.push(fields));
    guarded({ level: 'info', event: 'daemon.start', pid: 7 });
    expect(seen).toEqual([{ level: 'info', event: 'daemon.start', pid: 7 }]);
  });
});

// The binding the daemon uses, and the one a run-scoped CLI recorder will use.
// These are real-fs rather than sink-injection tests on purpose: what is being
// pinned is that the binding reaches the RIGHT FILE with the RIGHT identity,
// which an injected sink would stub out.
describe('boundRecorder', () => {
  it('stamps its bound fields on every event', () => {
    const root = workspace();
    const observe = boundRecorder({
      projectRoot: root,
      env: {},
      fields: { src: 'daemon', session_id: '8f2c1a3b4d5e6f70' },
    });

    observe({ level: 'info', event: 'daemon.start' });

    const events = readLines(path.join(root, 'mobile-automator', '.logs', 'mauto.ndjson'));
    expect(events).toHaveLength(1);
    expect(events[0].src).toBe('daemon');
    expect(events[0].session_id).toBe('8f2c1a3b4d5e6f70');
  });

  it('does not let a caller overwrite the identity fields', () => {
    // Bound fields are applied AFTER the caller's, so no call site can forge
    // `src` or claim another session's id.
    const root = workspace();
    const observe = boundRecorder({
      projectRoot: root,
      env: {},
      fields: { src: 'daemon', session_id: 'real' },
    });

    observe({ level: 'info', event: 'daemon.start', src: 'cli', session_id: 'forged' });

    const [event] = readLines(path.join(root, 'mobile-automator', '.logs', 'mauto.ndjson'));
    expect(event.src).toBe('daemon');
    expect(event.session_id).toBe('real');
  });

  it('honours an explicit logPath, writing there and never to the CLI log', () => {
    const root = workspace();
    const daemonLog = path.join(root, 'mobile-automator', '.logs', 'daemon.ndjson');
    const observe = boundRecorder({
      projectRoot: root,
      env: {},
      logPath: daemonLog,
      fields: { src: 'daemon', session_id: 'abc' },
    });

    observe({ level: 'info', event: 'call.end', tool: 'mobile_press_button', dur_ms: 41 });

    const events = readLines(daemonLog);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ src: 'daemon', event: 'call.end', tool: 'mobile_press_button' });
    expect(fs.existsSync(path.join(root, 'mobile-automator', '.logs', 'mauto.ndjson'))).toBe(false);
  });

  it('degrades to an inert observe when construction itself throws', () => {
    // Construction is the one moment outside the returned observe's own
    // never-throw guarantee: it resolves levels and builds sinks before any
    // event exists. So the totality belongs HERE, in the thing that constructs,
    // rather than in a try/catch every process that binds a recorder has to
    // remember to write. A throwing env getter makes defaultSinks fail for real
    // instead of the test asserting against an injected stub.
    const env = {
      get MAUTO_LOG_LEVEL() {
        throw new Error('sink construction exploded');
      },
    };

    const observe = boundRecorder({ projectRoot: workspace(), env, fields: { src: 'daemon' } });

    // Inert, not absent — the daemon must not have to branch on a null seam.
    expect(typeof observe).toBe('function');
    expect(() => observe({ level: 'error', event: 'daemon.crash' })).not.toThrow();
  });

  it('resolves levels ONCE, at construction, not per event', () => {
    // A long-lived detached process cannot have its environment changed from
    // outside, so re-reading it per event is pure waste. Mutating the env object
    // after construction must therefore have no effect: the debug event below
    // still lands even though the env now says silent.
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const root = workspace();
    const env = { MAUTO_LOG_LEVEL: 'debug' };
    const observe = boundRecorder({ projectRoot: root, env });

    env.MAUTO_LOG_LEVEL = 'silent';
    observe({ level: 'debug', event: 'call.start' });

    expect(readLines(path.join(root, 'mobile-automator', '.logs', 'mauto.ndjson'))).toHaveLength(1);
    stderrSpy.mockRestore();
  });
});
