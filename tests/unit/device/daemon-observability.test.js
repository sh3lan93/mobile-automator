'use strict';

// Behavioural guard for the daemon's instrumentation, in the shape slice 1
// settled on for the CLI (tests/integration/cli-observability.test.js): assert
// that an invocation actually leaves a trace, never that a particular line of
// source text exists.
//
// `observe` is injected as a collector, which is the same idiom the daemon
// already uses for createCall / scheduleTimeout / execFile.

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

const { startDaemon } = require('../../../src/device/session-daemon');
const sessionClient = require('../../../src/device/session-client');
const paths = require('../../../src/device/session-paths');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-daemon-obs-'));
}

function collector() {
  const events = [];
  const observe = (fields) => events.push(fields);
  observe.events = events;
  observe.named = (name) => events.filter((e) => e.event === name);
  return observe;
}

function makeFakeCreateCall(impl) {
  return async () => ({
    call: impl || (async (tool, args) => ({ echoed: tool, args })),
    close: async () => {},
  });
}

describe('daemon lifecycle events', () => {
  // No pid assertion here on purpose: pid is per-process identity, bound once
  // by the recorder (bin/mauto-session-daemon.js) rather than stamped by the
  // daemon, so a bare collector correctly never sees one. The wiring is pinned
  // in tests/unit/bin/mauto-session-daemon-observe.test.js and the stamping in
  // tests/unit/observe/recorder.test.js; the last test in this file proves the
  // two meet on disk.
  test('records daemon.start with the pinned device and a startup duration', async () => {
    const root = tmpRoot();
    const observe = collector();
    const daemon = await startDaemon({
      projectRoot: root,
      device: 'emulator-5554',
      idleMs: 0,
      createCall: makeFakeCreateCall(),
      observe,
    });

    const [start, ...rest] = observe.named('daemon.start');
    expect(rest).toEqual([]);
    expect(start.level).toBe('info');
    expect(start.pid).toBeUndefined();
    expect(start.device_id).toBe('emulator-5554');
    expect(typeof start.dur_ms).toBe('number');

    await daemon.stop();
  });

  test('writes session_id into the handle and exposes it on the daemon', async () => {
    const root = tmpRoot();
    const daemon = await startDaemon({
      projectRoot: root,
      idleMs: 0,
      createCall: makeFakeCreateCall(),
      sessionId: 'abcdef0123456789',
    });

    const handle = JSON.parse(fs.readFileSync(paths.handlePath(root), 'utf8'));
    expect(handle.session_id).toBe('abcdef0123456789');
    expect(daemon.sessionId).toBe('abcdef0123456789');

    await daemon.stop();
  });

  test('generates its own session id when none is supplied', async () => {
    const root = tmpRoot();
    const daemon = await startDaemon({ projectRoot: root, idleMs: 0, createCall: makeFakeCreateCall() });
    expect(daemon.sessionId).toMatch(/^[0-9a-f]{16}$/);
    await daemon.stop();
  });

  test('records daemon.stop with the reason and the session lifetime', async () => {
    const root = tmpRoot();
    const observe = collector();
    const daemon = await startDaemon({
      projectRoot: root,
      idleMs: 0,
      createCall: makeFakeCreateCall(),
      observe,
    });

    await daemon.stop();

    const [stop] = observe.named('daemon.stop');
    expect(stop.level).toBe('info');
    expect(stop.stop_reason).toBe('explicit');
    expect(typeof stop.dur_ms).toBe('number');
  });

  test('names the idle reap as the reason when the idle timer fires', async () => {
    const root = tmpRoot();
    const observe = collector();
    const daemon = await startDaemon({
      projectRoot: root,
      idleMs: 50,
      createCall: makeFakeCreateCall(),
      observe,
    });

    await daemon.whenStopped;

    expect(observe.named('daemon.stop')[0].stop_reason).toBe('idle');
  });

  test('names a shutdown frame as the reason', async () => {
    const root = tmpRoot();
    const observe = collector();
    const daemon = await startDaemon({
      projectRoot: root,
      idleMs: 0,
      createCall: makeFakeCreateCall(),
      observe,
    });

    expect(await sessionClient.requestShutdown(root)).toBe(true);
    await daemon.whenStopped;

    expect(observe.named('daemon.stop')[0].stop_reason).toBe('shutdown');
  });

  test('records at most one daemon.stop even when stop() is called twice', async () => {
    const root = tmpRoot();
    const observe = collector();
    const daemon = await startDaemon({
      projectRoot: root,
      idleMs: 0,
      createCall: makeFakeCreateCall(),
      observe,
    });

    await daemon.stop();
    await daemon.stop();

    expect(observe.named('daemon.stop')).toHaveLength(1);
  });
});

describe('daemon failure events', () => {
  test('records daemon.lock_conflict at warn when a second daemon loses the race', async () => {
    const root = tmpRoot();
    const winner = await startDaemon({ projectRoot: root, idleMs: 0, createCall: makeFakeCreateCall() });

    const observe = collector();
    await expect(
      startDaemon({ projectRoot: root, idleMs: 0, createCall: makeFakeCreateCall(), observe })
    ).rejects.toMatchObject({ code: 'ELOCKED' });

    const [conflict] = observe.named('daemon.lock_conflict');
    expect(conflict.level).toBe('warn');
    expect(conflict.error_code).toBe('ELOCKED');

    await winner.stop();
  });

  test('records daemon.connect_failure at error when mobile-mcp never comes up', async () => {
    const root = tmpRoot();
    const observe = collector();
    const boom = async () => {
      const err = new Error('no devices found');
      err.code = 'ENODEV';
      throw err;
    };

    await expect(
      startDaemon({ projectRoot: root, idleMs: 0, createCall: boom, observe })
    ).rejects.toThrow('no devices found');

    const [fail] = observe.named('daemon.connect_failure');
    expect(fail.level).toBe('error');
    expect(fail.error_code).toBe('ENODEV');
    // Free text stays local: `message` is sends:false in the catalog.
    expect(fail.message).toContain('no devices found');
    expect(typeof fail.dur_ms).toBe('number');
  });

  test('records daemon.listen_failure at error when the socket path cannot be bound', async () => {
    const root = tmpRoot();
    const observe = collector();
    // A DIRECTORY at the socket path survives cleanStale's safeUnlink, so
    // listen() fails deterministically without needing a real port race.
    fs.mkdirSync(paths.socketPath(root), { recursive: true });

    await expect(
      startDaemon({ projectRoot: root, idleMs: 0, createCall: makeFakeCreateCall(), observe })
    ).rejects.toThrow();

    const [fail] = observe.named('daemon.listen_failure');
    expect(fail.level).toBe('error');
    expect(typeof fail.error_code).toBe('string');
  });

  test('records daemon.start_failure at error when the session directory cannot be created', async () => {
    const root = tmpRoot();
    const observe = collector();
    // mkdirSync of .session/ is the FIRST filesystem operation startDaemon
    // performs, and it fails on the same EACCES/EROFS/ENOSPC class as the lock.
    // A regular FILE where the directory belongs reproduces that deterministically
    // — the same trick the listen_failure test above uses, and unlike a chmod it
    // still fails when the suite runs as root in CI.
    fs.mkdirSync(path.join(root, 'mobile-automator'), { recursive: true });
    fs.writeFileSync(paths.sessionDir(root), 'not a directory\n');

    await expect(
      startDaemon({ projectRoot: root, idleMs: 0, createCall: makeFakeCreateCall(), observe })
    ).rejects.toThrow();

    const [fail] = observe.named('daemon.start_failure');
    expect(fail.level).toBe('error');
    expect(typeof fail.error_code).toBe('string');
  });
});

describe('observability is never load-bearing', () => {
  // `observe` is an INJECTED seam, and the whole point of injecting one is that
  // something other than the default gets passed. The production recorder being
  // total makes the daemon safe TODAY; it does not make the DAEMON safe. These
  // tests hold the guarantee where it belongs — in startDaemon — so that no
  // future caller (Task 7's real recorder included) can turn a telemetry fault
  // into a dead device session. The failure mode being prevented is the daemon
  // dying at startup, killed by the code whose only job is to explain why
  // daemons die.
  const explode = () => {
    throw new Error('observe exploded');
  };

  test('a throwing observe does not stop the daemon from starting or stopping', async () => {
    const root = tmpRoot();

    const daemon = await startDaemon({
      projectRoot: root,
      idleMs: 0,
      createCall: makeFakeCreateCall(),
      observe: explode,
    });

    // The daemon is genuinely up, not merely un-thrown: the handle it writes
    // just before daemon.start is on disk.
    expect(JSON.parse(fs.readFileSync(paths.handlePath(root), 'utf8')).pid).toBe(process.pid);

    await expect(daemon.stop()).resolves.toBeUndefined();
    expect(fs.existsSync(paths.handlePath(root))).toBe(false);
  });

  test('a throwing observe on a failure path preserves the real error and releases the lock', async () => {
    const root = tmpRoot();
    const boom = async () => {
      const err = new Error('no devices found');
      err.code = 'ENODEV';
      throw err;
    };

    // The connect catch observes BEFORE releaseLock(). An observe that throws
    // there would both mask the real cause and leak the lock, wedging every
    // later spawn in this workspace.
    await expect(
      startDaemon({ projectRoot: root, idleMs: 0, createCall: boom, observe: explode })
    ).rejects.toMatchObject({ code: 'ENODEV' });

    expect(fs.existsSync(paths.lockPath(root))).toBe(false);

    // Proof the workspace is not wedged: a fresh daemon still takes the lock.
    const daemon = await startDaemon({ projectRoot: root, idleMs: 0, createCall: makeFakeCreateCall() });
    await daemon.stop();
  });

  // The two below are about the DEVICE-CALL path specifically, and they can
  // only be written at this level: makeDeviceCall lets a throwing observe
  // propagate on purpose (pinned in tests/unit/device/device-call.test.js), so
  // what is under test here is startDaemon's choice to hand it safeObserve.
  // That choice is invisible from inside device-call.js.
  test('a throwing observe does not swallow the device action it brackets', async () => {
    const root = tmpRoot();
    // call.start fires BEFORE call(), so an unguarded sink would mean the tap
    // never reaches the device — observability deciding whether an action runs.
    let calls = 0;
    const daemon = await startDaemon({
      projectRoot: root,
      idleMs: 0,
      createCall: makeFakeCreateCall(async (tool) => {
        calls += 1;
        return { echoed: tool };
      }),
      observe: explode,
    });

    const conn = await sessionClient.tryConnect(root);
    await expect(conn.call('mobile_press_button', { button: 'BACK' })).resolves.toEqual({
      echoed: 'mobile_press_button',
    });
    expect(calls).toBe(1);

    // Still usable afterwards, and the frame accounting is intact.
    await expect(conn.call('mobile_press_button', { button: 'HOME' })).resolves.toBeDefined();
    expect(calls).toBe(2);
    expect(await sessionClient.getSessionStatus(root)).toEqual({ running: true, in_flight: 0, device: null });

    await conn.close();
    await expect(daemon.stop()).resolves.toBeUndefined();
  });

  test('a throwing observe never masks the device error it was recording', async () => {
    const root = tmpRoot();
    const daemon = await startDaemon({
      projectRoot: root,
      idleMs: 0,
      createCall: makeFakeCreateCall(async () => {
        throw new Error('adb: device offline');
      }),
      observe: explode,
    });

    const conn = await sessionClient.tryConnect(root);
    let err = null;
    try {
      await conn.call('mobile_press_button', { button: 'BACK' });
    } catch (e) {
      err = e;
    }
    // The agent must be told what the DEVICE did, not what the log did.
    expect(err).not.toBeNull();
    expect(err.message).toBe('adb: device offline');
    expect(err.message).not.toMatch(/observe exploded/);

    expect(await sessionClient.getSessionStatus(root)).toEqual({ running: true, in_flight: 0, device: null });

    await conn.close();
    await daemon.stop();
  });
});

describe('device call events', () => {
  // The per-call event SHAPES are unit-tested against the decorator itself
  // (tests/unit/device/device-call.test.js), with no socket and no temp dir.
  // What survives here is what only the daemon can prove: that startDaemon
  // actually builds the decorator, hands it safeObserve and the daemon's
  // timeout, and routes call frames through it — the wiring, not the shape.
  test('records call.end at info with the primitive and a measured duration', async () => {
    const root = tmpRoot();
    const observe = collector();
    const daemon = await startDaemon({
      projectRoot: root,
      idleMs: 0,
      createCall: makeFakeCreateCall(),
      observe,
    });

    const conn = await sessionClient.tryConnect(root);
    await conn.call('mobile_press_button', { button: 'BACK' });
    await conn.close();

    const [end] = observe.named('call.end');
    expect(end.level).toBe('info');
    expect(end.ok).toBe(true);
    expect(end.tool).toBe('mobile_press_button');
    expect(typeof end.dur_ms).toBe('number');

    await daemon.stop();
  });





  test('records the undeliverable-reply seam as a warn event', async () => {
    const root = tmpRoot();
    const observe = collector();
    const daemon = await startDaemon({
      projectRoot: root,
      idleMs: 0,
      createCall: makeFakeCreateCall(async () => {
        // Long enough for the client to vanish before the reply goes out.
        await new Promise((r) => setTimeout(r, 40));
        return { done: true };
      }),
      observe,
    });

    const raw = net.connect(paths.socketPath(root));
    await new Promise((r) => raw.once('connect', r));
    raw.write(JSON.stringify({ id: 1, type: 'call', tool: 'mobile_press_button', args: {} }) + '\n');
    await new Promise((r) => setTimeout(r, 10));
    raw.destroy();
    await new Promise((r) => setTimeout(r, 120));

    expect(daemon.undeliverable.length).toBeGreaterThanOrEqual(1);
    const [warned] = observe.named('daemon.undeliverable');
    expect(warned.level).toBe('warn');
    expect(warned.message).toContain('id=1');

    // Ordering, asserted nowhere else: the measurement is recorded BEFORE the
    // reply is attempted, so a call whose reply can never be delivered still
    // leaves its latency behind. reply() can await socket drain for as long as
    // the peer takes, and the number we want is DEVICE latency, not delivery
    // latency — recording after the write would conflate them and, on this
    // path, would record nothing at all.
    const [end] = observe.named('call.end');
    expect(end.ok).toBe(true);
    expect(typeof end.dur_ms).toBe('number');

    await daemon.stop();
  });

  test('costs exactly one file append per device call at the default level', async () => {
    // The cost argument for keeping appendFileSync per event, pinned as a test:
    // call.start is debug and therefore off by default, so a scenario pays one
    // append per device call and nothing more.
    const { boundRecorder } = require('../../../src/observe/recorder');
    const { daemonEventLogPath } = require('../../../src/observe/paths');

    const root = tmpRoot();
    const logDir = path.join(root, 'logs');
    const env = { MAUTO_LOG_DIR: logDir };
    const daemon = await startDaemon({
      projectRoot: root,
      idleMs: 0,
      createCall: makeFakeCreateCall(),
      observe: boundRecorder({
        projectRoot: root,
        env,
        logPath: daemonEventLogPath(root, env),
        fields: { src: 'daemon', session_id: 'abcdef0123456789', pid: process.pid },
      }),
    });

    const conn = await sessionClient.tryConnect(root);
    await conn.call('mobile_press_button', { button: 'BACK' });
    await conn.call('mobile_press_button', { button: 'HOME' });
    await conn.close();

    const lines = fs
      .readFileSync(path.join(logDir, 'daemon.ndjson'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    const callLines = lines.filter((e) => String(e.event).startsWith('call.'));
    expect(callLines).toHaveLength(2);
    expect(callLines.every((e) => e.event === 'call.end')).toBe(true);
    expect(callLines.every((e) => e.session_id === 'abcdef0123456789')).toBe(true);
    // Where the two halves meet: the daemon stamps no pid anywhere, and every
    // line it wrote still carries one, because the recorder is bound with it.
    expect(lines.every((e) => e.pid === process.pid)).toBe(true);

    await daemon.stop();
  });
});
