'use strict';

// #345, end to end through buildProgram: a checked-in `.mobile-automator/` can
// ship a symlink to anywhere the user can read or write. Every store verb must
// refuse it with an `environment` envelope that names the path, never print
// what the link points at, and never touch the outside target.

const os = require('os');
const fs = require('fs');
const path = require('path');

const { buildProgram } = require('../../src/cli');
const { findWorkspaceRoot } = require('../../src/workspace/discover');

const CANARY = 'SECRET-CANARY';

function tmpDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-cli-safety-')));
}

function captureEmitters() {
  const calls = [];
  return {
    calls,
    emitters: {
      emit: (r) => calls.push(r),
      emitRaw: (raw, exitKind) => calls.push({ raw, exitKind }),
      finish: () => {},
      setVerb: () => {},
      setRunId: () => {},
      setSessionId: () => {},
      getRunId: () => null,
      getVerb: () => null,
    },
  };
}

// Every file under dir, relative path -> bytes.
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      const st = fs.lstatSync(p);
      if (st.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

// A workspace with a regular config.json and an outside/ directory holding the
// canary. `plant(ws, outside)` adds the symlink under test.
function fixture(plant) {
  const root = tmpDir();
  const ws = path.join(root, '.mobile-automator');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(ws);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(ws, 'config.json'), JSON.stringify({ mode: 'platform-aware' }, null, 2) + '\n');
  plant(ws, outside);
  return { root, ws, outside };
}

const fakeBridgeFactory = async () => ({
  bridge: { listDevices: async () => [{ id: 'emulator-5554', name: 'Pixel', platform: 'android' }] },
  close: async () => {},
});

async function runIn(root, argv, { deviceBridgeFactory = fakeBridgeFactory, emitterOverrides = {} } = {}) {
  const { calls, emitters: base } = captureEmitters();
  const emitters = { ...base, ...emitterOverrides };
  const written = [];
  const out = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
  const err = jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
  try {
    await buildProgram({
      cwd: root,
      workspace: findWorkspaceRoot(root),
      emitters,
      deviceBridgeFactory,
    }).parseAsync(['node', 'mauto', ...argv]);
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
  return { calls, written: written.join('') };
}

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

// A failure after the factory returned a connection must close it, whatever
// the error: the refusal above (readSessionId through a symlinked .session/)
// and an ordinary throw alike.
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
    expect(calls[0].envelope.error.message).toBe('boom after connect');
    expect(closed).toHaveLength(1);
  });
});
