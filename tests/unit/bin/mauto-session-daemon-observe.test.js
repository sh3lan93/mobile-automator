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

  beforeEach(() => {
    observed = [];
    started = null;
    stoppedWith = null;
    before = Object.fromEntries(GUARDS.map((g) => [g, process.listeners(g)]));

    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    boundRecorder.mockImplementation(() => (fields) => observed.push(fields));
    startDaemon.mockImplementation(async (opts) => {
      started = opts;
      return {
        sessionId: opts.sessionId,
        stop: async (reason) => {
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
  });

  it('injects that recorder and the same session id into startDaemon', async () => {
    start();
    await settle();

    expect(typeof started.observe).toBe('function');
    expect(started.sessionId).toBe(boundRecorder.mock.calls[0][0].fields.session_id);
    expect(started.projectRoot).toBe('/tmp/some-project');
  });

  it('records daemon.crash and stops with reason "crash" on an uncaught exception', async () => {
    start();
    await settle();

    const handler = process.listeners('uncaughtException').slice(-1)[0];
    const err = new Error('engine exploded');
    err.code = 'EPIPE';
    handler(err);
    await settle();

    const [crash] = observed.filter((e) => e.event === 'daemon.crash');
    expect(crash.level).toBe('error');
    expect(crash.error_code).toBe('EPIPE');
    expect(crash.message).toContain('engine exploded');
    expect(stoppedWith).toBe('crash');
    // The full stack still goes to the raw log unchanged (PR #176).
    expect(stderrSpy.mock.calls.some(([s]) => String(s).includes('uncaught'))).toBe(true);
  });

  it('records daemon.crash on an unhandled rejection too', async () => {
    start();
    await settle();

    const handler = process.listeners('unhandledRejection').slice(-1)[0];
    handler(new Error('promise exploded'));
    await settle();

    const [crash] = observed.filter((e) => e.event === 'daemon.crash');
    expect(crash.level).toBe('error');
    expect(crash.message).toContain('promise exploded');
    expect(stoppedWith).toBe('crash');
  });

  // The recorder must never be the reason the daemon fails to start. The
  // returned observe() already swallows everything (recorder.test.js pins
  // that); CONSTRUCTION is the one moment that is still outside its guarantee —
  // boundRecorder() resolves levels and computes a log path before any event
  // exists. So it degrades the same way session-log.js degrades to its frozen
  // IGNORED handle: no observability, but a live daemon.
  it('still starts the daemon when building the recorder throws', async () => {
    boundRecorder.mockImplementation(() => {
      throw new Error('sink construction exploded');
    });

    start();
    await settle();

    expect(startDaemon).toHaveBeenCalledTimes(1);
    expect(typeof started.observe).toBe('function');
    expect(started.sessionId).toMatch(/^[0-9a-f]{16}$/);
    // The degraded observe is inert, not absent — no call site has to branch.
    expect(() => started.observe({ level: 'error', event: 'daemon.crash' })).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

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
