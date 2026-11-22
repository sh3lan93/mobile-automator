'use strict';

// #345, end to end through buildProgram: a checked-in `.mobile-automator/` can
// ship a symlink to anywhere the user can read or write. Every store verb must
// refuse it with an `environment` envelope that names the path, never print
// what the link points at, and never touch the outside target.

const fs = require('fs');
const path = require('path');

const { CANARY, tmpDir, snapshot, fixture, runIn } = require('../helpers/workspace-safety');

const CASES = [
  {
    name: 'memory show with memory/run-history.md -> outside file',
    argv: ['memory', 'show'],
    plant: (ws, outside) => {
      fs.writeFileSync(path.join(outside, 'run-history.md'), `# Run History\n${CANARY}\n`);
      fs.mkdirSync(path.join(ws, 'memory'));
      fs.symlinkSync(path.join(outside, 'run-history.md'), path.join(ws, 'memory', 'run-history.md'));
    },
  },
  {
    name: 'config get mode with config.json -> outside file',
    argv: ['config', 'get', 'mode'],
    plant: (ws, outside) => {
      fs.writeFileSync(path.join(outside, 'config.json'), JSON.stringify({ mode: CANARY }));
      fs.rmSync(path.join(ws, 'config.json'));
      fs.symlinkSync(path.join(outside, 'config.json'), path.join(ws, 'config.json'));
    },
  },
  {
    name: 'result finalize with results/ -> outside dir',
    argv: ['result', 'finalize', '--run-id', 'r1'],
    plant: (ws, outside) => {
      fs.mkdirSync(path.join(outside, 'results'));
      fs.writeFileSync(
        path.join(outside, 'results', 'r1.json'),
        JSON.stringify({ run_id: 'r1', _in_progress: true, steps_executed: [], summary: CANARY })
      );
      fs.symlinkSync(path.join(outside, 'results'), path.join(ws, 'results'));
    },
  },
  {
    name: 'devices use with .session/ -> outside dir',
    argv: ['devices', 'use', 'emulator-5554'],
    plant: (ws, outside) => {
      fs.mkdirSync(path.join(outside, 'session'));
      fs.writeFileSync(path.join(outside, 'session', 'selection.json'), JSON.stringify({ device: CANARY }));
      fs.symlinkSync(path.join(outside, 'session'), path.join(ws, '.session'));
    },
  },
  {
    name: 'memory add with memory/ -> outside dir',
    argv: ['memory', 'add', 'a fact', '--kind', 'preferences'],
    plant: (ws, outside) => {
      fs.mkdirSync(path.join(outside, 'memory'));
      fs.writeFileSync(path.join(outside, 'memory', 'preferences.md'), `# Preferences\n- [2026-01-01] ${CANARY}\n`);
      fs.symlinkSync(path.join(outside, 'memory'), path.join(ws, 'memory'));
    },
  },
  {
    name: 'result add-step with results/ -> outside dir',
    argv: ['result', 'add-step', '--run-id', 'r1', '--step-id', 's1', '--status', 'pass'],
    plant: (ws, outside) => {
      fs.mkdirSync(path.join(outside, 'results'));
      fs.writeFileSync(
        path.join(outside, 'results', 'r1.json'),
        JSON.stringify({ run_id: 'r1', _in_progress: true, steps_executed: [], summary: CANARY })
      );
      fs.symlinkSync(path.join(outside, 'results'), path.join(ws, 'results'));
    },
  },
];

describe('store verbs refuse a symlinked workspace path (#345)', () => {
  test.each(CASES.map((c) => [c.name, c]))('%s', async (_name, { argv, plant }) => {
    const { root, outside } = fixture(plant);
    const before = snapshot(outside);

    const { calls, written } = await runIn(root, argv);

    expect(calls).toHaveLength(1);
    const [r] = calls;
    expect(r.exitKind).toBe('environment');
    expect(r.envelope.ok).toBe(false);
    expect(r.envelope.error.kind).toBe('environment');
    expect(r.envelope.error.message).toMatch(/Refusing to use workspace path/);
    expect(JSON.stringify(calls)).not.toContain(CANARY);
    expect(written).not.toContain(CANARY);
    expect(snapshot(outside)).toEqual(before);
  });
});

// A planted directory at the lock path is not a lock and cannot be unlinked:
// the verb refuses it as environment at once, rather than stalling to the
// lock's deadline and reporting internal.
describe('a directory at the memory lock path', () => {
  test('memory add fails environment and leaves it in place', async () => {
    const { root, ws } = fixture((w) => fs.mkdirSync(path.join(w, '.session', 'memory.lock'), { recursive: true }));

    const { calls } = await runIn(root, ['memory', 'add', 'a fact', '--kind', 'preferences']);

    expect(calls).toHaveLength(1);
    const [r] = calls;
    expect(r.exitKind).toBe('environment');
    expect(r.envelope.ok).toBe(false);
    expect(r.envelope.error.kind).toBe('environment');
    expect(r.envelope.error.message).toMatch(/not a regular file/);
    expect(fs.lstatSync(path.join(ws, '.session', 'memory.lock')).isDirectory()).toBe(true);
  });
});

// A failure after the factory returned a connection must close it, whatever
// the error: the refusal above (readSessionId through a symlinked .session/)
// and an ordinary throw alike. Both run inside the block whose `finally`
// closes the connection, so they are classified like any throw from the verb
// itself: by toEnvelope, not as a device-connect failure.
describe('connectBridge closes the connection on a failure after connect', () => {
  function closingFactory() {
    const closed = [];
    const factory = async () => ({
      bridge: { listDevices: async () => [{ id: 'emulator-5554', name: 'Pixel', platform: 'android' }] },
      close: async () => {
        closed.push(true);
      },
    });
    return { closed, factory };
  }

  test('a refused workspace path after connect closes it and fails environment', async () => {
    const { root } = fixture((ws, outside) => {
      fs.mkdirSync(path.join(outside, 'session'));
      fs.symlinkSync(path.join(outside, 'session'), path.join(ws, '.session'));
    });
    const { closed, factory } = closingFactory();
    const { calls } = await runIn(root, ['devices', 'use', 'emulator-5554'], { deviceBridgeFactory: factory });
    expect(calls).toHaveLength(1);
    expect(calls[0].exitKind).toBe('environment');
    expect(closed).toHaveLength(1);
  });

  // Only the handle leaf is planted, so readSessionId is the first reader to
  // hit it: the verb must fail there, before it touches the device, not later
  // when another reader of the handle trips over the same link.
  test('a refused session handle fails the verb before any device call', async () => {
    const { root } = fixture((ws, outside) => {
      fs.writeFileSync(path.join(outside, 'session.json'), JSON.stringify({ session_id: CANARY }));
      fs.mkdirSync(path.join(ws, '.session'));
      fs.symlinkSync(path.join(outside, 'session.json'), path.join(ws, '.session', 'session.json'));
    });
    const closed = [];
    const deviceCalls = [];
    const factory = async () => ({
      bridge: {
        listElements: async () => {
          deviceCalls.push('listElements');
          return [];
        },
      },
      close: async () => {
        closed.push(true);
      },
    });
    const { calls, written } = await runIn(root, ['elements', '--device', 'emulator-5554'], {
      deviceBridgeFactory: factory,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].exitKind).toBe('environment');
    expect(calls[0].envelope.error.message).toMatch(/Refusing to use workspace path/);
    expect(deviceCalls).toEqual([]);
    expect(closed).toHaveLength(1);
    expect(JSON.stringify(calls)).not.toContain(CANARY);
    expect(written).not.toContain(CANARY);
  });

  test('any other throw after connect closes it too, and still emits one envelope', async () => {
    const { root } = fixture(() => {});
    const { closed, factory } = closingFactory();
    const { calls } = await runIn(root, ['devices', 'use', 'emulator-5554'], {
      deviceBridgeFactory: factory,
      emitterOverrides: {
        setSessionId: () => {
          throw new Error('boom after connect');
        },
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].envelope.ok).toBe(false);
    expect(calls[0].exitKind).toBe('internal');
    expect(calls[0].envelope.error.message).toBe('boom after connect');
    expect(closed).toHaveLength(1);
  });
});

// #346: discovery refuses a symlinked workspace directory, so a gated verb
// fails environment before any store is touched.
describe('a symlinked .mobile-automator/ (#346)', () => {
  test.each([
    ['memory show', ['memory', 'show']],
    ['config get mode', ['config', 'get', 'mode']],
  ])('%s fails environment naming the path', async (_n, argv) => {
    const root = tmpDir();
    const real = path.join(root, 'real-ws');
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(real, 'config.json'), JSON.stringify({ mode: CANARY }));
    fs.symlinkSync(real, path.join(root, '.mobile-automator'));

    const { calls, written } = await runIn(root, argv);

    expect(calls).toHaveLength(1);
    const [r] = calls;
    expect(r.exitKind).toBe('environment');
    expect(r.envelope.ok).toBe(false);
    expect(r.envelope.error.kind).toBe('environment');
    expect(r.envelope.error.message).toContain(path.join(root, '.mobile-automator'));
    expect(r.envelope.error.message).toContain('(symlink)');
    expect(JSON.stringify(calls)).not.toContain(CANARY);
    expect(written).not.toContain(CANARY);
  });
});

// Only discovery can produce `autostart: false` here: with the workspace
// adopted the device verb would be handed autostart: true and a daemon (and its
// .session/) would be started inside the planted directory. So this fails when
// findWorkspaceRoot stops vetting, which the gated-verb tests above cannot show
// (the #345 stores refuse the same link on their own).
describe('a tolerant device verb in an unsafe workspace (#346)', () => {
  function plant(kind) {
    const root = tmpDir();
    const real = path.join(root, 'real-ws');
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(real, 'config.json'), JSON.stringify({ mode: 'platform-aware' }));
    if (kind === 'symlink') {
      fs.symlinkSync(real, path.join(root, '.mobile-automator'));
    } else {
      fs.renameSync(real, path.join(root, '.mobile-automator'));
      fs.chmodSync(path.join(root, '.mobile-automator'), 0o777);
    }
    return root;
  }

  const kinds = [['symlinked', 'symlink']];
  if (process.getuid() !== 0) kinds.push(['world-writable', 'world_writable']);

  test.each(kinds)('%s: elements connects with autostart false and creates nothing', async (_n, kind) => {
    const root = plant(kind);
    const target = kind === 'symlink' ? path.join(root, 'real-ws') : path.join(root, '.mobile-automator');
    const before = snapshot(target);
    const seen = [];
    const factory = async (opts) => {
      seen.push(opts);
      return { bridge: { listElements: async () => [] }, close: async () => {} };
    };

    const { calls } = await runIn(root, ['elements', '--device', 'emulator-5554'], { deviceBridgeFactory: factory });

    expect(seen).toHaveLength(1);
    expect(seen[0].autostart).toBe(false);
    expect(fs.existsSync(path.join(target, '.session'))).toBe(false);
    expect(snapshot(target)).toEqual(before);
    expect(calls).toHaveLength(1);
  });

  test('a gated verb in a world-writable workspace exits environment (5) naming the path', async () => {
    if (process.getuid() === 0) return;
    const root = plant('world_writable');
    const { calls } = await runIn(root, ['memory', 'show']);
    expect(calls).toHaveLength(1);
    expect(calls[0].exitKind).toBe('environment');
    expect(calls[0].envelope.error.message).toContain(path.join(root, '.mobile-automator'));
    expect(calls[0].envelope.error.message).toContain('(world_writable)');
  });
});

// setup is the one verb that creates a workspace where the user stands, so it
// is not behind requireWorkspace. Below a refused workspace, scaffolding would
// leave a nested workspace that silently hides the refusal for every later
// verb run there (#346): it refuses with the refusal itself instead, as it does
// beside a legacy workspace. Only discovery's `unsafe` result can stop it.
describe('setup in or below a refused workspace (#346)', () => {
  function plantSymlinked() {
    const root = tmpDir();
    const real = path.join(root, 'real-ws');
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(real, 'config.json'), JSON.stringify({ mode: 'platform-aware' }));
    fs.symlinkSync(real, path.join(root, '.mobile-automator'));
    const sub = path.join(root, 'pkg');
    fs.mkdirSync(sub);
    return { root, real, sub };
  }

  test('from a subdirectory: fails environment naming the refused path and scaffolds nothing', async () => {
    const { root, real, sub } = plantSymlinked();
    const before = snapshot(real);

    const { calls } = await runIn(root, ['setup'], { cwd: sub });

    expect(calls).toHaveLength(1);
    const [r] = calls;
    expect(r.exitKind).toBe('environment');
    expect(r.envelope.ok).toBe(false);
    expect(r.envelope.error.kind).toBe('environment');
    expect(r.envelope.error.message).toContain(path.join(root, '.mobile-automator'));
    expect(r.envelope.error.message).toContain('(symlink)');
    expect(r.envelope.hint).toBeTruthy();
    expect(fs.existsSync(path.join(sub, '.mobile-automator'))).toBe(false);
    expect(snapshot(real)).toEqual(before);
  });

  test('at the refused workspace itself: fails environment and leaves it untouched', async () => {
    const { root, real } = plantSymlinked();
    const before = snapshot(real);

    const { calls } = await runIn(root, ['setup']);

    expect(calls).toHaveLength(1);
    expect(calls[0].exitKind).toBe('environment');
    expect(calls[0].envelope.error.message).toContain('(symlink)');
    expect(snapshot(real)).toEqual(before);
  });
});
