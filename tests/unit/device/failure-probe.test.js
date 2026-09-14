'use strict';

const path = require('path');
const { execFileSync } = require('child_process');
const { probeCrashes, shouldProbe, CRASH_PROBE_TIMEOUT_MS } = require('../../../src/device/failure-probe');

const FAILURE_PROBE_PATH = path.join(__dirname, '..', '..', '..', 'src', 'device', 'failure-probe');

const ON = { MAUTO_OBSERVE: '1' };
const failEnv = (kind = 'device') => ({
  ok: false,
  error: { kind, message: 'element not found' },
  hint: 'Check the element is on screen.',
  schema_version: '2.1',
});
const okElements = (items) => ({ ok: true, data: items, schema_version: '2.1' });

const recent = { id: 'r1', process: 'com.acme.app', timestamp: '2026-09-05T10:30:00.000Z' };
const stale = { id: 'r0', process: 'com.acme.app', timestamp: '2026-08-01T10:30:00.000Z' };
const WATERMARK = '2026-09-05T10:00:00.000Z';

describe('shouldProbe', () => {
  it('fires on a device-kind and a timeout-kind failure', () => {
    expect(shouldProbe({ envelope: failEnv('device'), verb: 'tap' })).toBe(true);
    expect(shouldProbe({ envelope: failEnv('timeout'), verb: 'tap' })).toBe(true);
  });

  it('does not fire on non-device failures — those never mean the app died', () => {
    for (const kind of ['invalid_input', 'target_not_found', 'environment', 'internal']) {
      expect(shouldProbe({ envelope: failEnv(kind), verb: 'tap' })).toBe(false);
    }
  });

  it('does not fire on a successful action — the hot path stays untouched', () => {
    expect(shouldProbe({ envelope: { ok: true, data: { tapped: [1, 2] } }, verb: 'tap' })).toBe(false);
  });

  it('fires on an EMPTY elements list, which is the silent symptom of a dead app', () => {
    expect(shouldProbe({ envelope: okElements([]), verb: 'elements' })).toBe(true);
    expect(shouldProbe({ envelope: okElements([{ label: 'OK' }]), verb: 'elements' })).toBe(false);
  });

  it('never fires for `devices`, which also returns a bare array', () => {
    // `mauto devices` with nothing connected returns ok:[] through the same
    // seam. Probing there would mean asking a device that does not exist.
    expect(shouldProbe({ envelope: okElements([]), verb: 'devices' })).toBe(false);
    expect(shouldProbe({ envelope: failEnv('device'), verb: 'devices' })).toBe(false);
  });

  it('never fires for `crash`, which is itself the crash-diagnostic tool', () => {
    // A failing `crash get <bad-id>` (kind `device`) must not re-run
    // listCrashes() behind its back and staple an unrelated "the app
    // crashed, run `mauto crash get <other-id>`" hint onto the error it is
    // already reporting — that produced a self-contradictory envelope.
    expect(shouldProbe({ envelope: failEnv('device'), verb: 'crash' })).toBe(false);
    expect(shouldProbe({ envelope: failEnv('timeout'), verb: 'crash' })).toBe(false);
  });

  it('is total against a missing or malformed envelope', () => {
    expect(shouldProbe({ envelope: null, verb: 'tap' })).toBe(false);
    expect(shouldProbe({ envelope: undefined, verb: undefined })).toBe(false);
    expect(shouldProbe({ envelope: { ok: false }, verb: 'tap' })).toBe(false);
  });
});

describe('probeCrashes', () => {
  const opts = (bridge, extra = {}) => ({
    bridge,
    verb: 'tap',
    projectRoot: '/nope',
    env: ON,
    watermark: WATERMARK,
    sinks: [],
    ...extra,
  });

  it('attaches the crashes and amends the hint when the app died', async () => {
    const envelope = failEnv();
    const originalHint = envelope.hint;
    await probeCrashes(opts({ listCrashes: async () => [recent] }, { envelope }));
    expect(envelope.data.crashes).toEqual([recent]);
    expect(envelope.hint).toContain(originalHint);
    expect(envelope.hint).toMatch(/crash/i);
    expect(envelope.hint).toContain('mauto crash get');
  });

  it('leaves the original failure completely intact', async () => {
    const envelope = failEnv();
    await probeCrashes(opts({ listCrashes: async () => [recent] }, { envelope }));
    expect(envelope.ok).toBe(false);
    expect(envelope.error).toEqual({ kind: 'device', message: 'element not found' });
    expect(envelope.schema_version).toBe('2.1');
  });

  it('attaches an EARNED empty list when the device answered "none"', async () => {
    const envelope = failEnv();
    await probeCrashes(opts({ listCrashes: async () => [] }, { envelope }));
    expect(envelope.data.crashes).toEqual([]);
  });

  it('attaches NOTHING when the probe could not look', async () => {
    // The three-state contract: no `crashes` key means "unknown", and must not
    // be confused with the earned empty list above.
    const envelope = failEnv();
    const before = JSON.stringify(envelope);
    await probeCrashes(
      opts({ listCrashes: async () => { throw new Error('mobilecli is not available'); } }, { envelope })
    );
    expect(JSON.stringify(envelope)).toBe(before);
  });

  it('attaches NOTHING when there is no watermark to attribute against', async () => {
    const envelope = failEnv();
    const before = JSON.stringify(envelope);
    await probeCrashes(opts({ listCrashes: async () => [recent] }, { envelope, watermark: null }));
    expect(JSON.stringify(envelope)).toBe(before);
  });

  it('drops reports that predate the watermark — an old iOS report is not this crash', async () => {
    const envelope = failEnv();
    await probeCrashes(opts({ listCrashes: async () => [stale, recent] }, { envelope }));
    expect(envelope.data.crashes.map((c) => c.id)).toEqual(['r1']);
  });

  it('gives up on its own deadline rather than inheriting the daemon 25s timeout', async () => {
    const envelope = failEnv();
    const before = JSON.stringify(envelope);
    const hang = { listCrashes: () => new Promise(() => {}) };
    const started = Date.now();
    await probeCrashes(opts(hang, { envelope, timeoutMs: 20 }));
    expect(Date.now() - started).toBeLessThan(1000);
    expect(JSON.stringify(envelope)).toBe(before);
  });

  it('exposes a deadline shorter than one daemon call', async () => {
    // Derived, not restated: src/device/session-daemon.js owns the daemon's
    // per-call timeout and exports it as DAEMON_CALL_TIMEOUT_MS. A hardcoded
    // 25000 here would keep passing after someone changed the daemon.
    const { DAEMON_CALL_TIMEOUT_MS } = require('../../../src/device/session-daemon');
    expect(CRASH_PROBE_TIMEOUT_MS).toBeLessThan(DAEMON_CALL_TIMEOUT_MS);
  });

  it('is inert when the gate is off', async () => {
    const envelope = failEnv();
    const before = JSON.stringify(envelope);
    let called = false;
    await probeCrashes(
      opts({ listCrashes: async () => { called = true; return [recent]; } }, { envelope, env: {} })
    );
    expect(called).toBe(false);
    expect(JSON.stringify(envelope)).toBe(before);
  });

  it('never throws, whatever the bridge does', async () => {
    for (const bridge of [null, {}, { listCrashes: null }, { listCrashes: () => { throw new Error('x'); } }]) {
      const envelope = failEnv();
      await expect(probeCrashes(opts(bridge, { envelope }))).resolves.toBeUndefined();
    }
  });

  it('sets the hint on an empty-elements OK envelope without touching data', async () => {
    const envelope = okElements([]);
    await probeCrashes(opts({ listCrashes: async () => [recent] }, { envelope, verb: 'elements' }));
    expect(envelope.data).toEqual([]); // still the elements array, unpolluted
    expect(envelope.hint).toMatch(/crash/i);
  });

  it('confirms an earned-clear result on the ok:true path too — not just when crashes are found', async () => {
    // The three-state contract must survive on the ok:true elements path even
    // though `data` can never carry it there (it is the elements array, not an
    // object). Without this, "we checked and it's clean" and "we never
    // checked" would render identically to the agent.
    const envelope = okElements([]);
    await probeCrashes(opts({ listCrashes: async () => [] }, { envelope, verb: 'elements' }));
    expect(envelope.data).toEqual([]);
    expect(envelope.hint).toMatch(/crash/i);
    expect(envelope.hint).not.toMatch(/mauto crash get/);
  });

  it('counts a report with an unreadable timestamp as unattributed instead of dropping it (ok:false path)', async () => {
    const envelope = failEnv();
    const gozero = { id: 'gozero', process: 'p', timestamp: '0001-01-01T00:00:00Z' };
    await probeCrashes(opts({ listCrashes: async () => [gozero] }, { envelope }));
    // An earned-empty `crashes: []` here would be indistinguishable from "the
    // device genuinely reported none" — exactly the confident wrong answer the
    // Task-2 fix (crashTimestampMs's epoch floor) was written to prevent.
    expect(envelope.data.crashes).toEqual([]);
    expect(envelope.data.unattributed).toBe(1);
    expect(envelope.hint).toMatch(/unattributed|unreadable|could not/i);
    expect(envelope.hint).not.toMatch(/none found/i);
  });

  it('counts a report with an unreadable timestamp as unattributed instead of dropping it (ok:true elements path)', async () => {
    const envelope = okElements([]);
    const gozero = { id: 'gozero', process: 'p', timestamp: '0001-01-01T00:00:00Z' };
    await probeCrashes(opts({ listCrashes: async () => [gozero] }, { envelope, verb: 'elements' }));
    expect(envelope.data).toEqual([]); // still unpolluted — no data slot on this path
    expect(envelope.hint).toMatch(/unattributed|unreadable|could not/i);
    // Must not read like the earned-clear "none found" hint, and must not
    // claim a crash was actually found either.
    expect(envelope.hint).not.toMatch(/none found/i);
    expect(envelope.hint).not.toMatch(/mauto crash get/);
  });

  it('keeps a real in-window crash and an unattributed report distinguishable at once', async () => {
    const envelope = failEnv();
    const gozero = { id: 'gozero', process: 'p', timestamp: '0001-01-01T00:00:00Z' };
    await probeCrashes(opts({ listCrashes: async () => [recent, gozero] }, { envelope }));
    expect(envelope.data.crashes).toEqual([recent]);
    expect(envelope.data.unattributed).toBe(1);
  });

  it('keeps an EARNED-clear result truly zero-attributed, not just zero-crashes', async () => {
    // The default for a genuinely clean answer must be unattributed: 0, not
    // undefined — matching handleCrashList's contract in src/cli.js.
    const envelope = failEnv();
    await probeCrashes(opts({ listCrashes: async () => [] }, { envelope }));
    expect(envelope.data).toEqual({ crashes: [], unattributed: 0 });
  });
});

describe('probeCrashes deadline vs. an empty event loop', () => {
  // jest itself always holds handles open (its own timers/workers), so a unit
  // test inside jest cannot distinguish a ref'd timer from an unref'd one: the
  // race would resolve either way. The bug only manifests when NOTHING else is
  // keeping the process alive — which is exactly the shape of a one-shot `mauto`
  // verb once connectBridge's own socket handling has already torn down. Proving
  // it requires a real, separate process with a genuinely empty event loop
  // apart from the probe's own timer.
  it('resolves the deadline instead of hanging forever when the bridge call never settles', () => {
    const script = `
      const { probeCrashes } = require(${JSON.stringify(FAILURE_PROBE_PATH)});
      const envelope = {
        ok: false,
        error: { kind: 'device', message: 'element not found' },
        hint: 'Check the element is on screen.',
        schema_version: '2.1',
      };
      probeCrashes({
        bridge: { listCrashes: () => new Promise(() => {}) },
        envelope,
        verb: 'tap',
        projectRoot: '/nope',
        env: { MAUTO_OBSERVE: '1' },
        watermark: '2026-09-05T10:00:00.000Z',
        sinks: [],
        timeoutMs: 50,
      }).then(() => {
        process.stdout.write('PROBE_RESOLVED');
      });
    `;
    const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 5000 });
    expect(out).toBe('PROBE_RESOLVED');
  });
});
