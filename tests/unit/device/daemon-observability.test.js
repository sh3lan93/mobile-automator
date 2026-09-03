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
  test('records daemon.start with the pid, the pinned device and a startup duration', async () => {
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
    expect(start.pid).toBe(process.pid);
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
});

describe('device call events', () => {
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

  test('brackets a call with a debug call.start, so a call that never returns still leaves a trace', async () => {
    const root = tmpRoot();
    const observe = collector();
    const daemon = await startDaemon({
      projectRoot: root,
      idleMs: 0,
      createCall: makeFakeCreateCall(),
      observe,
    });

    const conn = await sessionClient.tryConnect(root);
    await conn.call('mobile_list_elements_on_screen', {});
    await conn.close();

    const [start] = observe.named('call.start');
    expect(start.level).toBe('debug');
    expect(start.tool).toBe('mobile_list_elements_on_screen');

    await daemon.stop();
  });

  test('records a mobile-mcp failure at warn with the device error kind', async () => {
    const root = tmpRoot();
    const observe = collector();
    const daemon = await startDaemon({
      projectRoot: root,
      idleMs: 0,
      createCall: makeFakeCreateCall(async () => {
        throw new Error('adb: device offline');
      }),
      observe,
    });

    const conn = await sessionClient.tryConnect(root);
    await expect(conn.call('mobile_press_button', { button: 'BACK' })).rejects.toThrow();
    await conn.close();

    const [end] = observe.named('call.end');
    expect(end.level).toBe('warn');
    expect(end.ok).toBe(false);
    expect(end.error_kind).toBe('device');
    expect(end.message).toContain('adb: device offline');

    await daemon.stop();
  });

  test('records a timeout with error_kind timeout, reusing the envelope taxonomy', async () => {
    const root = tmpRoot();
    const observe = collector();
    const daemon = await startDaemon({
      projectRoot: root,
      idleMs: 0,
      // Never settles, so the timeout branch always wins the race.
      createCall: makeFakeCreateCall(() => new Promise(() => {})),
      scheduleTimeout: () => Promise.resolve(),
      observe,
    });

    const conn = await sessionClient.tryConnect(root);
    await expect(conn.call('mobile_swipe_on_screen', {})).rejects.toThrow();
    await conn.close();

    const [end] = observe.named('call.end');
    expect(end.error_kind).toBe('timeout');
    expect(end.ok).toBe(false);

    await daemon.stop();
  });

  test('omits the tool name when the frame did not name a known primitive', async () => {
    const root = tmpRoot();
    const observe = collector();
    const daemon = await startDaemon({
      projectRoot: root,
      idleMs: 0,
      createCall: makeFakeCreateCall(),
      observe,
    });

    // The socket is reachable by anything on the machine, so `tool` must never
    // be trusted as the enumerated value the catalog says it is.
    const conn = await sessionClient.tryConnect(root);
    await conn.call('/Users/someone/unreleased-thing.apk', {});
    await conn.close();

    const [end] = observe.named('call.end');
    expect(end.ok).toBe(true);
    expect(end.tool).toBeUndefined();

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

    await daemon.stop();
  });

  test('costs exactly one file append per device call at the default level', async () => {
    // The cost argument for keeping appendFileSync per event, pinned as a test:
    // call.start is debug and therefore off by default, so a scenario pays one
    // append per device call and nothing more.
    const { makeDaemonRecorder } = require('../../../src/observe/daemon-recorder');

    const root = tmpRoot();
    const logDir = path.join(root, 'logs');
    const env = { MAUTO_LOG_DIR: logDir };
    const daemon = await startDaemon({
      projectRoot: root,
      idleMs: 0,
      createCall: makeFakeCreateCall(),
      observe: makeDaemonRecorder({ projectRoot: root, sessionId: 'abcdef0123456789', env }),
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

    await daemon.stop();
  });
});
