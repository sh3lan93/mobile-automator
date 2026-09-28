'use strict';

const transport = require('../../../src/observe/transport');

function fakeFetch(impl) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return impl(calls.length);
  };
  fn.calls = calls;
  return fn;
}

const res = (status) => ({ status, ok: status >= 200 && status < 300 });

describe('telemetry transport', () => {
  const PAYLOADS = [
    { ts: '2026-09-05T10:00:00.000Z', event: 'verb.end', msg_id: 'aaaa', verb: 'tap', ok: true, dur_ms: 41 },
  ];

  it('ships a real token, distinct from the placeholder', () => {
    // A maintainer has pasted the real project key (graduation, Task 12); the
    // shipped default now resolves usable without any env override.
    expect(transport.resolveToken({})).not.toBe(transport.TOKEN_PLACEHOLDER);
    expect(transport.hasToken({})).toBe(true);
  });

  it('rejects the placeholder wherever it appears — shipped or explicitly set', () => {
    expect(transport.hasToken({ MAUTO_TELEMETRY_TOKEN: transport.TOKEN_PLACEHOLDER })).toBe(false);
    expect(transport.hasToken({ MAUTO_TELEMETRY_TOKEN: 'phc_real' })).toBe(true);
  });

  it('lets a self-hoster redirect host and token without touching the code', () => {
    expect(transport.endpointUrl({})).toBe('https://eu.i.posthog.com/batch/');
    expect(transport.endpointUrl({ MAUTO_TELEMETRY_HOST: 'https://ph.example.test' }))
      .toBe('https://ph.example.test/batch/');
    // A trailing slash on the host must not produce a double slash.
    expect(transport.endpointUrl({ MAUTO_TELEMETRY_HOST: 'https://ph.example.test/' }))
      .toBe('https://ph.example.test/batch/');
  });

  it('posts the documented PostHog batch shape and adds nothing of its own', async () => {
    const f = fakeFetch(() => res(200));
    const r = await transport.postBatch(PAYLOADS, { fetchImpl: f, env: { MAUTO_TELEMETRY_TOKEN: 'phc_real' } });

    expect(r).toEqual({ ok: true, retry: false, status: 200 });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe('https://eu.i.posthog.com/batch/');
    expect(f.calls[0].init.method).toBe('POST');
    expect(f.calls[0].init.headers['Content-Type']).toBe('application/json');

    const body = f.calls[0].body;
    expect(body.api_key).toBe('phc_real');
    expect(body.batch).toHaveLength(1);

    const ev = body.batch[0];
    expect(ev.event).toBe('verb.end');
    expect(ev.timestamp).toBe('2026-09-05T10:00:00.000Z');
    expect(ev.uuid).toBe('aaaa');
    expect(ev.properties.distinct_id).toBe('mauto-anonymous');
    expect(ev.properties.$process_person_profile).toBe(false);
    // The remaining spool keys ride through as properties, verbatim...
    expect(ev.properties.verb).toBe('tap');
    expect(ev.properties.dur_ms).toBe(41);
    // ...and the three that became wire fields are not duplicated into them.
    expect(ev.properties).not.toHaveProperty('event');
    expect(ev.properties).not.toHaveProperty('ts');
    expect(ev.properties).not.toHaveProperty('msg_id');
  });

  it('never creates a person profile — a stable person is the fingerprint we refuse to have', async () => {
    const f = fakeFetch(() => res(200));
    await transport.postBatch(PAYLOADS, { fetchImpl: f, env: { MAUTO_TELEMETRY_TOKEN: 'phc_real' } });
    const ids = f.calls[0].body.batch.map((e) => e.properties.distinct_id);
    expect(new Set(ids)).toEqual(new Set(['mauto-anonymous']));
  });

  it('treats 4xx as permanent so a revoked token cannot retry forever', async () => {
    for (const status of [400, 401, 403, 413]) {
      const f = fakeFetch(() => res(status));
      const r = await transport.postBatch(PAYLOADS, { fetchImpl: f, env: { MAUTO_TELEMETRY_TOKEN: 'phc_real' } });
      expect(r).toEqual({ ok: false, retry: false, status });
    }
  });

  it('treats 429 and 5xx as retryable', async () => {
    for (const status of [429, 500, 502, 503]) {
      const f = fakeFetch(() => res(status));
      const r = await transport.postBatch(PAYLOADS, { fetchImpl: f, env: { MAUTO_TELEMETRY_TOKEN: 'phc_real' } });
      expect(r).toEqual({ ok: false, retry: true, status });
    }
  });

  it('treats a thrown network error as retryable and never propagates it', async () => {
    const f = async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    };
    const r = await transport.postBatch(PAYLOADS, { fetchImpl: f, env: { MAUTO_TELEMETRY_TOKEN: 'phc_real' } });
    expect(r).toEqual({ ok: false, retry: true, status: 0 });
  });

  it('refuses to post without a real token, and does not call fetch to find out', async () => {
    const f = fakeFetch(() => res(200));
    const r = await transport.postBatch(PAYLOADS, {
      fetchImpl: f,
      env: { MAUTO_TELEMETRY_TOKEN: transport.TOKEN_PLACEHOLDER },
    });
    expect(r).toEqual({ ok: false, retry: false, status: 0 });
    expect(f.calls).toHaveLength(0);
  });

  it('posts nothing for an empty batch', async () => {
    const f = fakeFetch(() => res(200));
    const r = await transport.postBatch([], { fetchImpl: f, env: { MAUTO_TELEMETRY_TOKEN: 'phc_real' } });
    expect(r).toEqual({ ok: true, retry: false, status: 0 });
    expect(f.calls).toHaveLength(0);
  });

  // Addendum (binding on Tasks 2-12): telemetryPayload() can now return a
  // payload with an unrecognised event name dropped by accepts(). Posting
  // that fragment under an invented event name would be worse than dropping
  // it, so transport.js must skip it rather than defaulting one in.
  it('skips a payload with no event field rather than inventing one', async () => {
    const f = fakeFetch(() => res(200));
    const withGap = [
      ...PAYLOADS,
      { ts: '2026-09-05T10:00:01.000Z', msg_id: 'bbbb' },
    ];
    const r = await transport.postBatch(withGap, { fetchImpl: f, env: { MAUTO_TELEMETRY_TOKEN: 'phc_real' } });
    expect(r).toEqual({ ok: true, retry: false, status: 200 });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].body.batch).toHaveLength(1);
    expect(f.calls[0].body.batch[0].uuid).toBe('aaaa');
  });

  it('posts nothing when every payload in the batch is missing an event', async () => {
    const f = fakeFetch(() => res(200));
    const r = await transport.postBatch(
      [{ ts: '2026-09-05T10:00:01.000Z', msg_id: 'bbbb' }],
      { fetchImpl: f, env: { MAUTO_TELEMETRY_TOKEN: 'phc_real' } },
    );
    expect(r).toEqual({ ok: true, retry: false, status: 0 });
    expect(f.calls).toHaveLength(0);
  });

  it('degrades rather than throwing on a runtime with no global fetch', async () => {
    const r = await transport.postBatch(PAYLOADS, {
      fetchImpl: null,
      env: { MAUTO_TELEMETRY_TOKEN: 'phc_real' },
    });
    expect(r).toEqual({ ok: false, retry: false, status: 0 });
  });

  // Requirement: the request must be bounded even if the fetch implementation
  // never resolves and ignores the abort signal entirely (a naive fake here,
  // but also a defensive bound against a runtime whose fetch doesn't honour
  // AbortSignal the way undici does). This must resolve, not hang the process.
  it('bounds a hung request by the deadline instead of waiting forever', async () => {
    const hangingFetch = () => new Promise(() => {});
    const r = await transport.postBatch(PAYLOADS, {
      fetchImpl: hangingFetch,
      env: { MAUTO_TELEMETRY_TOKEN: 'phc_real' },
      timeoutMs: 20,
    });
    expect(r).toEqual({ ok: false, retry: true, status: 0 });
  });

  // Requirement: the deadline timer must not be left ref'd-and-forgotten after
  // a fast success — that would keep an otherwise-idle process (the daemon's
  // event loop, or a bare `node -e`) alive for the rest of POST_TIMEOUT_MS for
  // no reason. src/device/failure-probe.js's withDeadline sets the precedent:
  // clear the timer in a finally, on every branch.
  it('does not leave a live timer behind after a fast response', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      const f = fakeFetch(() => res(200));
      const p = transport.postBatch(PAYLOADS, {
        fetchImpl: f,
        env: { MAUTO_TELEMETRY_TOKEN: 'phc_real' },
        timeoutMs: 5000,
      });
      await Promise.resolve();
      await Promise.resolve();
      const r = await p;
      expect(r.ok).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
