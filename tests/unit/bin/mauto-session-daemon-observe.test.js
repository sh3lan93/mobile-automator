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

    boundRecorder.mockImplementation(() => (fields) => {
      order.push('observe');
      observed.push(fields);
    });
    startDaemon.mockImplementation(async (opts) => {
      started = opts;
      return {
        sessionId: opts.sessionId,
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

  it('builds the recorder bound to the project root and a fresh session id', async () => {
    start();
    await settle();

    expect(boundRecorder).toHaveBeenCalledTimes(1);
    const args = boundRecorder.mock.calls[0][0];
    expect(args.projectRoot).toBe('/tmp/some-project');
    expect(args.fields.session_id).toMatch(/^[0-9a-f]{16}$/);
    // pid is per-process identity, exactly like src and session_id, so it is
    // BOUND rather than hand-stamped at each event. Bound fields are applied
    // after the caller's, so no daemon call site can misreport it.
    expect(args.fields.pid).toBe(process.pid);
    expect(args.fields.src).toBe('daemon');
  });

  it('injects that recorder and the same session id into startDaemon', async () => {
    start();
    await settle();

    expect(typeof started.observe).toBe('function');
    expect(started.sessionId).toBe(boundRecorder.mock.calls[0][0].fields.session_id);
    expect(started.projectRoot).toBe('/tmp/some-project');
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
    expect(exitSpy).toHaveBeenCalledWith(1);
    if (release) release({ stop: async () => {}, whenStopped: new Promise(() => {}) });
  });
});
