'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

const { captureOnFailure } = require('../../../src/observe/failure-capture');

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-failcap-'));
  fs.mkdirSync(path.join(root, 'mobile-automator'), { recursive: true });
  return root;
}

function traceEvents(root, runId) {
  const file = path.join(root, 'mobile-automator', '.logs', `run-${runId}.ndjson`);
  return fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
}

const ENV = { MAUTO_LOG_LEVEL: 'info' };

const failing = (kind) => ({
  envelope: { ok: false, error: { kind, message: 'element not found' } },
  exitKind: kind,
});
const passing = () => ({ envelope: { ok: true, data: {} }, exitKind: 'ok' });

function fakeBridge() {
  const calls = [];
  return {
    calls,
    async screenshot(dest) {
      calls.push(dest);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, 'PNG');
      return dest;
    },
  };
}

describe('screenshot on device failure', () => {
  it('captures on a device failure and records the path in the trace', async () => {
    const root = workspace();
    const bridge = fakeBridge();

    const shot = await captureOnFailure({
      bridge, result: failing('device'), projectRoot: root, runId: 'smoke', verb: 'tap', env: ENV,
    });

    expect(shot).toBeTruthy();
    expect(fs.existsSync(shot)).toBe(true);
    // Under screenshots/, which mobile-automator/.gitignore covers.
    expect(shot.startsWith(path.join(root, 'mobile-automator', 'screenshots', 'smoke'))).toBe(true);

    const events = traceEvents(root, 'smoke');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: 'screenshot.on_failure', verb: 'tap', run_id: 'smoke', error_kind: 'device', path: shot,
    });
  });

  // A timed-out call may have PARTIALLY executed — session-client says so in
  // its own hint — so the screen is the only way to learn what happened. It is
  // arguably the more valuable of the two kinds.
  it('captures on a timeout too', async () => {
    const root = workspace();
    const shot = await captureOnFailure({
      bridge: fakeBridge(), result: failing('timeout'), projectRoot: root, runId: 'smoke', verb: 'type', env: ENV,
    });
    expect(shot).toBeTruthy();
    expect(traceEvents(root, 'smoke')[0].error_kind).toBe('timeout');
  });

  it('captures nothing on success, invalid_input or internal', async () => {
    const root = workspace();
    for (const result of [passing(), failing('invalid_input'), failing('internal')]) {
      const bridge = fakeBridge();
      const shot = await captureOnFailure({
        bridge, result, projectRoot: root, runId: 'smoke', verb: 'tap', env: ENV,
      });
      expect(shot).toBeNull();
      expect(bridge.calls).toEqual([]);
    }
    expect(traceEvents(root, 'smoke')).toEqual([]);
  });

  // No run id means no trace to reference the file from and no finalize to
  // collect it, so the PNG would be litter in a directory the user did not ask
  // us to fill. It also makes the run id the single switch for this slice.
  it('captures nothing without a usable run id', async () => {
    const root = workspace();
    for (const runId of [null, undefined, '', '../../escaped', 'a/b']) {
      const bridge = fakeBridge();
      const shot = await captureOnFailure({
        bridge, result: failing('device'), projectRoot: root, runId, verb: 'tap', env: ENV,
      });
      expect(shot).toBeNull();
      expect(bridge.calls).toEqual([]);
    }
  });

  // THE property. The capture is itself a daemon round-trip and can fail for
  // exactly the reasons the original call failed.
  it('records and discards its own failure, never throwing and never touching the result', async () => {
    const root = workspace();
    const result = failing('device');
    const before = JSON.stringify(result);
    const bridge = {
      async screenshot() {
        const e = new Error('daemon socket closed');
        e.kind = 'device';
        throw e;
      },
    };

    let shot;
    await expect(
      (async () => {
        shot = await captureOnFailure({
          bridge, result, projectRoot: root, runId: 'smoke', verb: 'tap', env: ENV,
        });
      })()
    ).resolves.toBeUndefined();

    expect(shot).toBeNull();
    expect(JSON.stringify(result)).toBe(before);

    const events = traceEvents(root, 'smoke');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: 'screenshot.capture_failed', verb: 'tap' });
    expect(events[0].message).toContain('daemon socket closed');
  });

  // The module's own docstring claims "It never throws." runTracePath
  // short-circuits an INVALID run id before ever touching projectRoot, which
  // is why that path alone would not catch a regression here — it has to be a
  // VALID run id so the call reaches logsDir's path.join(projectRoot, ...) and
  // a non-string projectRoot throws a TypeError there instead of at a caller
  // this module does not control.
  it('never throws when projectRoot is not a string, even with a valid run id', async () => {
    const bridge = fakeBridge();
    await expect(
      captureOnFailure({
        bridge, result: failing('device'), projectRoot: undefined, runId: 'run_20260101_000001', verb: 'tap', env: ENV,
      })
    ).resolves.toBeNull();
  });

  it('survives a bridge with no screenshot method and an unwritable workspace', async () => {
    const root = workspace();
    await expect(
      captureOnFailure({ bridge: {}, result: failing('device'), projectRoot: root, runId: 'smoke', env: ENV })
    ).resolves.toBeNull();
    await expect(
      captureOnFailure({ bridge: null, result: failing('device'), projectRoot: root, runId: 'smoke', env: ENV })
    ).resolves.toBeNull();
  });
});
