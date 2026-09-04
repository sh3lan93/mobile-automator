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
});
