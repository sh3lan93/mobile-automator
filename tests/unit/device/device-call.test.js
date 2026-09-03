'use strict';

// Unit tests for the bounded, measured device call.
//
// No socket, no temp dir, no net server: this is the whole point of pulling the
// per-call instrumentation out of the daemon's data handler. Every dependency
// is a plain function, so the cases below cover shapes (a synchronously
// throwing call, a falsy rejection, an unknown tool that also times out) that
// were unreachable through a Unix socket at nesting depth 6.

const { makeDeviceCall } = require('../../../src/device/device-call');

// Collector shaped like the daemon's `observe`.
function collector() {
  const events = [];
  const observe = (fields) => events.push(fields);
  observe.events = events;
  observe.named = (name) => events.filter((e) => e.event === name);
  return observe;
}

// Default injections: a timeout that never fires, so `call` always wins.
function build(call, overrides = {}) {
  const observe = overrides.observe || collector();
  const invoke = makeDeviceCall(call, {
    observe,
    scheduleTimeout: overrides.scheduleTimeout || (() => new Promise(() => {})),
    timeoutMs: overrides.timeoutMs === undefined ? 25000 : overrides.timeoutMs,
  });
  return { invoke, observe };
}

const KNOWN = 'mobile_press_button';
const UNKNOWN = '/Users/someone/unreleased-thing.apk';

describe('makeDeviceCall: results', () => {
  test('returns exactly what call returned', async () => {
    const result = { elements: [] };
    const { invoke } = build(async () => result);
    expect(await invoke(KNOWN, {})).toBe(result);
  });

  test('returns undefined when call returns undefined', async () => {
    const { invoke } = build(async () => undefined);
    expect(await invoke(KNOWN, {})).toBeUndefined();
  });

  test('passes the raw tool string and the caller\'s own args object through untouched', async () => {
    const args = { button: 'BACK' };
    const seen = [];
    const { invoke } = build(async (tool, a) => {
      seen.push([tool, a]);
      return null;
    });

    await invoke(UNKNOWN, args);

    expect(seen[0][0]).toBe(UNKNOWN); // raw, not the checked name
    expect(seen[0][1]).toBe(args); // same object: no clone, no default
  });
});

describe('makeDeviceCall: happy-path events', () => {
  test('emits exactly a debug call.start then an info call.end, and nothing else', async () => {
    const { invoke, observe } = build(async () => ({}));

    await invoke(KNOWN, {});

    expect(observe.events).toHaveLength(2);
    const [start, end] = observe.events;
    expect(start).toEqual({ level: 'debug', event: 'call.start', tool: KNOWN });
    expect(end.level).toBe('info');
    expect(end.event).toBe('call.end');
    expect(end.ok).toBe(true);
    expect(end.tool).toBe(KNOWN);
    expect(typeof end.dur_ms).toBe('number');
  });

  test('omits the tool from BOTH events when the frame did not name a known primitive', async () => {
    const { invoke, observe } = build(async () => ({ served: true }));

    // Unknown tools are still SERVED — only the telemetry name is withheld.
    expect(await invoke(UNKNOWN, {})).toEqual({ served: true });

    expect(observe.named('call.start')[0].tool).toBeUndefined();
    expect(observe.named('call.end')[0].tool).toBeUndefined();
  });

  test('measures real elapsed time', async () => {
    const { invoke, observe } = build(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    await invoke(KNOWN, {});

    expect(observe.named('call.end')[0].dur_ms).toBeGreaterThanOrEqual(25);
  });

  test('two overlapping invocations produce two independent start/end pairs', async () => {
    const resolvers = [];
    const { invoke, observe } = build(() => new Promise((r) => resolvers.push(r)));

    const a = invoke(KNOWN, {});
    const b = invoke('mobile_swipe_on_screen', {});
    resolvers[1]({ which: 'b' });
    resolvers[0]({ which: 'a' });
    expect(await a).toEqual({ which: 'a' });
    expect(await b).toEqual({ which: 'b' });

    expect(observe.named('call.start').map((e) => e.tool)).toEqual([KNOWN, 'mobile_swipe_on_screen']);
    expect(observe.named('call.end').map((e) => e.tool)).toEqual(['mobile_swipe_on_screen', KNOWN]);
    expect(observe.named('call.end').every((e) => e.ok === true)).toBe(true);
  });
});

describe('makeDeviceCall: the timeout bound', () => {
  test('rejects with kind:timeout, the verify-state hint and the timeout budget', async () => {
    const { invoke, observe } = build(() => new Promise(() => {}), {
      scheduleTimeout: async () => {},
    });

    await expect(invoke(KNOWN, {})).rejects.toMatchObject({ kind: 'timeout' });

    let err;
    try {
      await invoke(KNOWN, {});
    } catch (e) {
      err = e;
    }
    expect(err.hint).toMatch(/verify state/);
    expect(err.message).toContain('25000ms');

    const end = observe.named('call.end')[0];
    expect(end.level).toBe('warn');
    expect(end.ok).toBe(false);
    expect(end.error_kind).toBe('timeout');
  });

  test('names the RAW tool in the timeout message, even one the tool set does not know', async () => {
    // The tripwire for a `${name}`-for-`${tool}` slip: with an unknown tool the
    // checked name is undefined, so the message would read "undefined: ...".
    const { invoke } = build(() => new Promise(() => {}), { scheduleTimeout: async () => {} });

    let err;
    try {
      await invoke(UNKNOWN, {});
    } catch (e) {
      err = e;
    }
    expect(err.message.startsWith(UNKNOWN)).toBe(true);
  });

  test('reports the INJECTED budget, not a hardcoded constant', async () => {
    const { invoke } = build(() => new Promise(() => {}), {
      scheduleTimeout: async () => {},
      timeoutMs: 1234,
    });

    await expect(invoke(KNOWN, {})).rejects.toThrow(/within 1234ms/);
  });

  test('swallows the race loser: a rejection after the timeout won raises no unhandled rejection', async () => {
    let rejectLater;
    const { invoke } = build(() => new Promise((_, reject) => {
      rejectLater = reject;
    }), { scheduleTimeout: async () => {} });

    const seen = [];
    const onUnhandled = (reason) => seen.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      await expect(invoke(KNOWN, {})).rejects.toMatchObject({ kind: 'timeout' });
      rejectLater(new Error('the device answered, far too late'));
      // Flush a macrotask: node raises unhandledRejection at the end of the
      // microtask drain that follows.
      await new Promise((r) => setTimeout(r, 10));
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
    expect(seen).toEqual([]);
  });
});

describe('makeDeviceCall: failures', () => {
  test('rethrows the very same error instance, unannotated', async () => {
    const boom = new Error('adb: device offline');
    const { invoke } = build(async () => {
      throw boom;
    });

    let err;
    try {
      await invoke(KNOWN, {});
    } catch (e) {
      err = e;
    }
    expect(err).toBe(boom);
    expect(err.kind).toBeUndefined();
    expect(err.hint).toBeUndefined();
  });

  test('records one warn call.end classified as a device failure', async () => {
    const { invoke, observe } = build(async () => {
      throw new Error('adb: device offline');
    });

    await expect(invoke(KNOWN, {})).rejects.toThrow();

    const ends = observe.named('call.end');
    expect(ends).toHaveLength(1);
    expect(ends[0].level).toBe('warn');
    expect(ends[0].ok).toBe(false);
    expect(ends[0].error_kind).toBe('device');
    expect(ends[0].message).toBe('adb: device offline');
    expect(typeof ends[0].dur_ms).toBe('number');
  });

  test('a synchronously throwing call still records call.end and rejects', async () => {
    const { invoke, observe } = build(() => {
      throw new Error('createCall handed back a broken call');
    });

    await expect(invoke(KNOWN, {})).rejects.toThrow('broken call');

    const [end] = observe.named('call.end');
    expect(end.ok).toBe(false);
    expect(end.error_kind).toBe('device');
  });

  test('a call returning a non-thenable still records call.end and rejects', async () => {
    // p.catch is a TypeError here; it must be classified, not escape naked.
    const { invoke, observe } = build(() => 'not a promise');

    await expect(invoke(KNOWN, {})).rejects.toThrow(TypeError);

    const [end] = observe.named('call.end');
    expect(end.ok).toBe(false);
    expect(end.error_kind).toBe('device');
  });

  test('a falsy rejection is an ordinary failure, not a TypeError', async () => {
    const { invoke, observe } = build(async () => {
      throw null; // eslint-disable-line no-throw-literal
    });

    let threw = false;
    let caught = 'unset';
    try {
      await invoke(KNOWN, {});
    } catch (e) {
      threw = true;
      caught = e;
    }
    expect(threw).toBe(true);
    expect(caught).toBeNull();

    const [end] = observe.named('call.end');
    expect(end.ok).toBe(false);
    expect(end.error_kind).toBe('device');
    expect(end.message).toBeNull();
  });
});

describe('makeDeviceCall: construction', () => {
  const ok = {
    observe: () => {},
    scheduleTimeout: () => new Promise(() => {}),
    timeoutMs: 25000,
  };

  test('rejects a non-function call', () => {
    expect(() => makeDeviceCall(undefined, ok)).toThrow(TypeError);
  });

  test('rejects a non-function observe', () => {
    expect(() => makeDeviceCall(async () => {}, { ...ok, observe: null })).toThrow(TypeError);
  });

  test('rejects a non-function scheduleTimeout', () => {
    expect(() => makeDeviceCall(async () => {}, { ...ok, scheduleTimeout: 25000 })).toThrow(TypeError);
  });

  test('rejects a missing or non-finite timeoutMs rather than defaulting', () => {
    // A default would make every call time out "within undefinedms" instead of
    // failing loudly at construction.
    for (const bad of [undefined, null, NaN, Infinity, 0, -1, '25000']) {
      expect(() => makeDeviceCall(async () => {}, { ...ok, timeoutMs: bad })).toThrow(TypeError);
    }
  });

  test('with no options at all it throws rather than building a useless call', () => {
    expect(() => makeDeviceCall(async () => {})).toThrow(TypeError);
  });
});

describe('makeDeviceCall: the observe contract', () => {
  test('a throwing observe PROPAGATES — the decorator is not independently guarded', async () => {
    // Deliberate. The daemon supplies safeObserve (session-daemon.js), so the
    // never-load-bearing guarantee lives at exactly one place instead of being
    // re-applied here and silently diverging. Pinned so nobody "fixes" this by
    // adding a second try/catch and hiding a sink that is genuinely broken.
    const { invoke } = build(async () => ({}), {
      observe: () => {
        throw new Error('observe exploded');
      },
    });

    await expect(invoke(KNOWN, {})).rejects.toThrow('observe exploded');
  });
});
