'use strict';

const { makeEvent, telemetryPayload, EVENT_FIELDS, LEVELS } = require('../../../src/observe/event');

describe('makeEvent', () => {
  it('stamps the ambient fields', () => {
    const e = makeEvent({ event: 'verb.end', verb: 'tap', ok: true });
    expect(e.event).toBe('verb.end');
    expect(e.verb).toBe('tap');
    expect(typeof e.ts).toBe('string');
    expect(e.v).toBe(1);
    expect(e.mauto_version).toBe(require('../../../package.json').version);
    expect(e.node).toBe(process.version);
    expect(e.os).toBe(process.platform);
  });

  it('drops keys the catalog does not declare', () => {
    const e = makeEvent({ event: 'verb.end', smuggled: 'com.acme.secret' });
    expect(e).not.toHaveProperty('smuggled');
  });

  it('omits keys whose value is undefined rather than emitting null', () => {
    const e = makeEvent({ event: 'verb.end', dur_ms: undefined });
    expect(e).not.toHaveProperty('dur_ms');
  });
});

describe('telemetryPayload', () => {
  it('strips every sends:false field', () => {
    const e = makeEvent({
      event: 'verb.end',
      verb: 'launch',
      ok: false,
      error_kind: 'device',
      app_id: 'com.acme.unreleased',
      run_id: 'checkout-redesign-smoke',
      message: 'element "Buy now" not found',
    });
    const p = telemetryPayload(e);
    expect(p.verb).toBe('launch');
    expect(p.error_kind).toBe('device');
    expect(p).not.toHaveProperty('app_id');
    expect(p).not.toHaveProperty('run_id');
    expect(p).not.toHaveProperty('message');
  });

  it('never emits a key absent from the catalog even if present on the event', () => {
    const p = telemetryPayload({ event: 'verb.end', rogue: 'x' });
    expect(p).not.toHaveProperty('rogue');
  });
});

describe('catalog integrity', () => {
  it('declares sends and a reason for every field', () => {
    for (const [name, def] of Object.entries(EVENT_FIELDS)) {
      expect(typeof def.sends).toBe('boolean');
      expect(typeof def.why).toBe('string');
      expect(def.why.length).toBeGreaterThan(0);
    }
  });

  it('exposes the four levels in ascending severity', () => {
    expect(LEVELS).toEqual(['debug', 'info', 'warn', 'error']);
  });

  it('already classifies every field slice 3 records', () => {
    // Slice 3 adds NO new catalog field, and this is what keeps that true: a
    // later change that starts recording something unclassified fails here
    // rather than having makeEvent drop it silently.
    for (const f of ['run_id', 'session_id', 'path', 'verb', 'ok', 'error_kind', 'dur_ms', 'message']) {
      expect(EVENT_FIELDS[f]).toBeDefined();
      expect(typeof EVENT_FIELDS[f].why).toBe('string');
    }
    expect(EVENT_FIELDS.run_id.sends).toBe(false);
    expect(EVENT_FIELDS.path.sends).toBe(false);
  });
});

describe('daemon field classifications', () => {
  const { EVENT_FIELDS, NEVER_SENDS, makeEvent, telemetryPayload } = require('../../../src/observe/event');

  it('lets the daemon carry a session id, a call id, a primitive name, a stop reason and an errno', () => {
    // call_id is sends:true on the same grounds as dur_ms: a daemon-minted
    // monotonic integer, never the client-chosen id from the socket frame.
    for (const f of ['session_id', 'call_id', 'tool', 'stop_reason', 'error_code']) {
      expect(EVENT_FIELDS[f]).toBeDefined();
      expect(EVENT_FIELDS[f].sends).toBe(true);
    }
  });

  it('keeps pid local — a pid plus a timestamp is a host correlator with no aggregate value', () => {
    expect(EVENT_FIELDS.pid.sends).toBe(false);
    expect(NEVER_SENDS).toContain('pid');
  });

  it('round-trips a daemon call event through makeEvent without dropping a field', () => {
    const e = makeEvent({
      src: 'daemon',
      event: 'call.end',
      session_id: '8f2c1a3b4d5e6f70',
      tool: 'mobile_press_button',
      ok: false,
      error_kind: 'timeout',
      dur_ms: 25000,
      pid: 4242,
    });
    expect(e.tool).toBe('mobile_press_button');
    expect(e.session_id).toBe('8f2c1a3b4d5e6f70');
    expect(e.pid).toBe(4242);

    const p = telemetryPayload(e);
    expect(p.tool).toBe('mobile_press_button');
    expect(p.session_id).toBe('8f2c1a3b4d5e6f70');
    expect(p).not.toHaveProperty('pid');
  });
});

describe('crash field classifications', () => {
  const { EVENT_FIELDS, NEVER_SENDS, makeEvent, telemetryPayload } = require('../../../src/observe/event');

  it('lets a crash event carry a count', () => {
    expect(EVENT_FIELDS.crash_count).toBeDefined();
    expect(EVENT_FIELDS.crash_count.sends).toBe(true);
    expect(typeof EVENT_FIELDS.crash_count.why).toBe('string');
    expect(EVENT_FIELDS.crash_count.why.trim().length).toBeGreaterThan(0);
  });

  it('mints NO new field for the crashed process or the stack — those reuse app_id and message', () => {
    // Slice 4 deliberately adds one field, not four. A crashed process name IS
    // an app id and a stack excerpt IS free text; both already have a correct
    // sends:false classification, and a near-copy would be a second decision to
    // keep in sync with the first.
    expect(EVENT_FIELDS.crash_process).toBeUndefined();
    expect(EVENT_FIELDS.crash_excerpt).toBeUndefined();
    expect(EVENT_FIELDS.app_id.sends).toBe(false);
    expect(EVENT_FIELDS.message.sends).toBe(false);
    expect(NEVER_SENDS).toContain('app_id');
    expect(NEVER_SENDS).toContain('message');
  });

  it('round-trips a crash event, sending the count and nothing else about it', () => {
    const e = makeEvent({
      src: 'cli',
      event: 'crash.detected',
      verb: 'tap',
      crash_count: 2,
      app_id: 'com.acme.unreleased-thing',
      message: 'FATAL EXCEPTION: main\n\tat com.acme.Login.onClick(Login.java:42)',
      path: '/Users/someone/proj/mobile-automator/results/crash-1.txt',
    });
    expect(e.crash_count).toBe(2);
    expect(e.app_id).toBe('com.acme.unreleased-thing');

    const p = telemetryPayload(e);
    expect(p.crash_count).toBe(2);
    expect(p).not.toHaveProperty('app_id');
    expect(p).not.toHaveProperty('message');
    expect(p).not.toHaveProperty('path');
  });
});

describe('telemetry transport field classifications', () => {
  const { EVENT_FIELDS, makeEvent, telemetryPayload } = require('../../../src/observe/event');

  it('lets a spooled line carry a delivery id, a batch size and an HTTP status', () => {
    for (const f of ['msg_id', 'count', 'http_status']) {
      expect(EVENT_FIELDS[f]).toBeDefined();
      expect(EVENT_FIELDS[f].sends).toBe(true);
    }
  });

  it('round-trips a flush event through makeEvent without dropping a field', () => {
    const e = makeEvent({
      src: 'daemon',
      event: 'telemetry.flush',
      msg_id: 'b3a1c0de4f5a6b7c8d9e0f1a2b3c4d5e',
      count: 42,
      http_status: 200,
      ok: true,
      dur_ms: 137,
    });
    const p = telemetryPayload(e);
    expect(p.msg_id).toBe('b3a1c0de4f5a6b7c8d9e0f1a2b3c4d5e');
    expect(p.count).toBe(42);
    expect(p.http_status).toBe(200);
  });
});
