'use strict';

// The daemon process is the ONLY place the real recorder is constructed, so
// this is the only test that can prove the wiring exists.
//
// It is behavioural rather than a grep over the source, but it cannot be a
// full end-to-end spawn: running the real bin means running the real
// createCall, which spawns mobile-mcp and talks to whatever devices happen to
// be attached to the machine. So session-daemon and the recorder seam are
// mocked and main() is driven directly.

jest.mock('../../../src/device/session-daemon');
jest.mock('../../../src/observe/recorder');

const { startDaemon } = require('../../../src/device/session-daemon');
const { boundRecorder } = require('../../../src/observe/recorder');
const { main } = require('../../../bin/mauto-session-daemon');

const GUARDS = ['uncaughtException', 'unhandledRejection', 'exit'];

// The id startDaemon mints. It is the DAEMON's to mint, not this file's, so the
// mock below produces one exactly the way the real startDaemon does.
const DAEMON_SESSION = 'abcdef0123456789';

describe('bin/mauto-session-daemon observability wiring', () => {
  let observed;
  let started;
  let stoppedWith;
  let before;
  let stderrSpy;
  let exitSpy;
  let order;

  beforeEach(() => {
    observed = [];
    started = null;
    stoppedWith = null;
    order = [];
    before = Object.fromEntries(GUARDS.map((g) => [g, process.listeners(g)]));

    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => {
      order.push('stderr');
      return true;
    });
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      order.push('exit');
    });

    // Faithful to the real boundRecorder in the one respect these tests turn
    // on: the BOUND fields are applied last, so a collected event carries the
    // identity its recorder was built with. Without that, a mock could not tell
    // the boot recorder apart from the daemon's.
    boundRecorder.mockImplementation((args) => (fields) => {
      order.push('observe');
      observed.push({ ...fields, ...(args && args.fields) });
    });
    startDaemon.mockImplementation(async (opts) => {
      started = opts;
      return {
        sessionId: DAEMON_SESSION,
        // What the real startDaemon does with the injected factory: mint an id,
        // bind it, and hand the bound recorder back so the caller's crash guards
        // can adopt it.
        observe: opts.recorderFor({ src: 'daemon', session_id: DAEMON_SESSION, pid: process.pid }),
        stop: async (reason) => {
          order.push('stop');
          stoppedWith = reason;
        },
        // Never resolves: main() awaits this, which is what keeps a real
        // daemon alive. The test does not await main().
        whenStopped: new Promise(() => {}),
      };
    });

    process.env.MAUTO_SESSION_PROJECT_ROOT = '/tmp/some-project';
  });

  afterEach(() => {
    for (const g of GUARDS) {
      for (const fn of process.listeners(g)) {
        if (!before[g].includes(fn)) process.removeListener(g, fn);
      }
    }
    delete process.env.MAUTO_SESSION_PROJECT_ROOT;
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
    jest.clearAllMocks();
  });

  // Lets main()'s awaits run without awaiting main() itself, which never
  // returns — it ends on `await daemon.whenStopped`. Two macrotask turns, so
  // the `daemon = await startDaemon(...)` assignment has definitely landed
  // before a test reaches for it.
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  };

  // main() is deliberately not awaited, so its rejection (if any) must be
  // absorbed here rather than escaping as an unhandled rejection into jest.
  const start = () => main().catch(() => {});

  it('builds a boot recorder bound to the project root and this process', async () => {
    start();
    await settle();

    const args = boundRecorder.mock.calls[0][0];
    expect(args.projectRoot).toBe('/tmp/some-project');
    // pid is per-process identity, so it is BOUND rather than hand-stamped at
    // each event. Bound fields are applied after the caller's, so no call site
    // can misreport it.
    expect(args.fields).toEqual({ src: 'daemon', pid: process.pid });
    // No session_id, deliberately: before startDaemon resolves there is no
    // session to name. An id minted here would name a daemon that never wrote a
    // handle, so nothing could be joined against it — and `pid` already groups
    // those events.
    expect(args.fields.session_id).toBeUndefined();
  });

  it('injects a recorder FACTORY, never a session id, into startDaemon', async () => {
    start();
    await settle();

    // startDaemon is the sole owner of session_id: it mints the id and is
    // therefore the only thing that can bind a recorder to it. This file owns
    // WHERE the events go; startDaemon owns WHOSE they are. A `sessionId`
    // travelling the other way is the divergence this replaced.
    expect(typeof started.recorderFor).toBe('function');
    expect(started.sessionId).toBeUndefined();
    expect(started.observe).toBeUndefined();
    expect(started.projectRoot).toBe('/tmp/some-project');

    // The factory builds the daemon's own recorder against the same log file —
    // the mock startDaemon above already called it once with the id it minted.
    const forDaemon = boundRecorder.mock.calls[1][0];
    expect(forDaemon.projectRoot).toBe('/tmp/some-project');
    expect(forDaemon.logPath).toBe(boundRecorder.mock.calls[0][0].logPath);
    expect(forDaemon.fields.session_id).toBe(DAEMON_SESSION);
  });

  it('adopts the daemon\'s session-bound recorder once the daemon exists', async () => {
    // The common case, and the one worth the swap: a crash long after startup
    // must be joinable to the handle sitting on disk.
    start();
    await settle();

    process.listeners('uncaughtException').slice(-1)[0](new Error('late death'));
    await settle();

    const [crash] = observed.filter((e) => e.event === 'daemon.crash');
    expect(crash.session_id).toBe(DAEMON_SESSION);
  });

  // The two crash guards do the same four things, in an order that is itself
  // load-bearing, and differ by exactly two strings. Driven from a table so the
  // pair cannot drift and so every property is asserted for BOTH rather than
  // for whichever one someone remembered to cover.
  describe.each([
    ['uncaughtException', 'uncaughtException', 'uncaught'],
    ['unhandledRejection', 'unhandledRejection', 'unhandled rejection'],
  ])('the %s crash guard', (guard, messagePrefix, stderrLabel) => {
    const fire = async (err) => {
      start();
      await settle();
      order.length = 0; // drop main()'s own startup banner write
      process.listeners(guard).slice(-1)[0](err);
      await settle();
    };

    it('records daemon.crash at error, classified and with the engine message', async () => {
      const err = new Error('engine exploded');
      err.code = 'EPIPE';
      await fire(err);

      const [crash, ...rest] = observed.filter((e) => e.event === 'daemon.crash');
      expect(rest).toEqual([]);
      expect(crash.level).toBe('error');
      expect(crash.error_code).toBe('EPIPE');
      expect(crash.message).toBe(`${messagePrefix}: engine exploded`);
    });

    it('records BEFORE the stderr write and before the teardown', async () => {
      // These are the invisible deaths #156 is about and process.exit(1) is
      // immediate, so the event has to be written first; and the teardown that
      // frees the lock/socket/pidfile must never be delayed by the recording.
      await fire(new Error('engine exploded'));
      expect(order).toEqual(['observe', 'stderr', 'stop', 'exit']);
    });

    it('still writes the full stack to the raw log, and exits 1', async () => {
      // Two writes on purpose, to two different readers: the structured event
      // carries the classification, the raw write is #176's contract.
      const err = new Error('engine exploded');
      await fire(err);

      const [line] = stderrSpy.mock.calls.slice(-1)[0];
      expect(String(line)).toContain(stderrLabel);
      expect(String(line)).toContain(err.stack);
      expect(stoppedWith).toBe('crash');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('survives a falsy crash value rather than replacing it with a TypeError', async () => {
      await fire(null);

      const [crash] = observed.filter((e) => e.event === 'daemon.crash');
      expect(crash.error_code).toBeNull(); // `err && err.code` on a falsy err
      expect(crash.message).toBe(`${messagePrefix}: null`);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  // NOTE: "the recorder must never be the reason the daemon fails to start" is
  // pinned in tests/unit/observe/recorder.test.js, against the REAL
  // boundRecorder, because that is where construction totality now lives. It
  // cannot be asserted here: boundRecorder is mocked in this file, so a version
  // of this test would only be checking the mock.

  // A crash before startDaemon resolved must still record and still tear down
  // the workspace files — `daemon` is null, so the guard must not assume it.
  it('survives a crash that fires before startDaemon has resolved', async () => {
    let release;
    startDaemon.mockImplementation(
      () => new Promise((resolve) => {
        release = resolve;
      })
    );

    start();
    await settle();

    const handler = process.listeners('uncaughtException').slice(-1)[0];
    expect(() => handler(new Error('early death'))).not.toThrow();
    await settle();

    const [crash] = observed.filter((e) => e.event === 'daemon.crash');
    expect(crash.message).toContain('early death');
    // Recorded under the boot recorder, so it carries the process identity and
    // no session. That is honest rather than lossy: a crash before startDaemon
    // resolved never wrote a handle, so an id here would name nothing.
    expect(crash.pid).toBe(process.pid);
    expect(crash.session_id).toBeUndefined();
    expect(exitSpy).toHaveBeenCalledWith(1);
    if (release) release({ stop: async () => {}, whenStopped: new Promise(() => {}) });
  });
});
