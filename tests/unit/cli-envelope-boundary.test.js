'use strict';

// Regression tests for issue #120: uncaught exceptions must NEVER escape the
// uniform `{ok,error,...}` envelope contract. Each test drives one escape class
// through the real program wiring and asserts EXACTLY ONE envelope reaches the
// emit sink with the right `error.kind` + exitKind — never a raw stack trace.

const os = require('os');
const fs = require('fs');
const path = require('path');

const { buildProgram, toEnvelope, diagnose } = require('../../src/cli');

function tmpRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Build a program whose emit sink CAPTURES (it does not call process.exit), so
// a test sees every envelope the boundary produced and can assert there is one.
function captureProgram(projectRoot, extraDeps = {}) {
  const calls = [];
  const program = buildProgram({
    projectRoot,
    emit: (r) => calls.push(r),
    ...extraDeps,
  });
  return { program, calls };
}

const argv = (...rest) => ['node', 'mauto', ...rest];

describe('envelope boundary (#120)', () => {
  describe('toEnvelope classifier', () => {
    test('SyntaxError -> invalid_input with a JSON hint', () => {
      const r = toEnvelope(new SyntaxError('Unexpected token } in JSON'));
      expect(r.exitKind).toBe('invalid_input');
      expect(r.envelope.ok).toBe(false);
      expect(r.envelope.error.kind).toBe('invalid_input');
      expect(r.envelope.hint).toMatch(/malformed/i);
    });

    test('fs EACCES/EROFS/ENOSPC/ENOENT -> environment with a filesystem hint', () => {
      for (const code of ['EACCES', 'EROFS', 'ENOSPC', 'ENOENT']) {
        const err = Object.assign(new Error(`${code}: nope`), { code });
        const r = toEnvelope(err);
        expect(r.exitKind).toBe('environment');
        expect(r.envelope.error.kind).toBe('environment');
        expect(r.envelope.hint).toMatch(/filesystem/i);
      }
    });

    test('any other error -> internal (no hint)', () => {
      const r = toEnvelope(new Error('boom'));
      expect(r.exitKind).toBe('internal');
      expect(r.envelope.error.kind).toBe('internal');
      expect(r.envelope.error.message).toBe('boom');
    });
  });

  describe('diagnose (stderr trace for unexpected internals only)', () => {
    test('writes a stack to stderr for internal, but stays quiet for environment/invalid_input', () => {
      const spy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
      let internalCalls;
      let otherCalls;
      try {
        diagnose(new Error('boom'), 'internal');
        internalCalls = spy.mock.calls.length;
        diagnose(Object.assign(new Error('EACCES: nope'), { code: 'EACCES' }), 'environment');
        diagnose(new SyntaxError('bad json'), 'invalid_input');
        otherCalls = spy.mock.calls.length - internalCalls;
      } finally {
        spy.mockRestore();
      }
      expect(internalCalls).toBe(1); // the unexpected internal error got its trace
      expect(otherCalls).toBe(0); // expected/diagnosed classes stayed off stderr
    });
  });

  test('(a) corrupt config.json -> one invalid_input envelope (config get)', async () => {
    const root = tmpRoot('mauto-b120-cfg-');
    fs.mkdirSync(path.join(root, 'mobile-automator'), { recursive: true });
    fs.writeFileSync(path.join(root, 'mobile-automator', 'config.json'), '{ not: valid json');
    const { program, calls } = captureProgram(root);

    await program.parseAsync(argv('config', 'get', 'mode'));

    expect(calls).toHaveLength(1);
    expect(calls[0].exitKind).toBe('invalid_input');
    expect(calls[0].envelope.ok).toBe(false);
    expect(calls[0].envelope.error.kind).toBe('invalid_input');
  });

  test('(a2) corrupt config.json also caught on guide (config.load before the handler try)', async () => {
    const root = tmpRoot('mauto-b120-guide-');
    fs.mkdirSync(path.join(root, 'mobile-automator'), { recursive: true });
    fs.writeFileSync(path.join(root, 'mobile-automator', 'config.json'), '{{ broken');
    const { program, calls } = captureProgram(root);

    await program.parseAsync(argv('guide', 'execute'));

    expect(calls).toHaveLength(1);
    expect(calls[0].envelope.error.kind).toBe('invalid_input');
  });

  test('(c) malformed existing .mcp.json on init -> one invalid_input envelope', async () => {
    const root = tmpRoot('mauto-b120-init-');
    fs.writeFileSync(path.join(root, '.mcp.json'), '{ broken json');
    const { program, calls } = captureProgram(root);

    await program.parseAsync(argv('init', '--agent', 'claude'));

    expect(calls).toHaveLength(1);
    expect(calls[0].exitKind).toBe('invalid_input');
    expect(calls[0].envelope.error.kind).toBe('invalid_input');
  });

  // Read-only FS perms don't constrain root; skip when uid 0 (some CI images).
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  (isRoot ? test.skip : test)('(d) setup on a read-only project root -> one environment envelope', async () => {
    const root = tmpRoot('mauto-b120-ro-');
    fs.chmodSync(root, 0o555);
    try {
      const { program, calls } = captureProgram(root);
      await program.parseAsync(argv('setup'));
      expect(calls).toHaveLength(1);
      expect(calls[0].exitKind).toBe('environment');
      expect(calls[0].envelope.ok).toBe(false);
      expect(calls[0].envelope.error.kind).toBe('environment');
      expect(calls[0].envelope.hint).toMatch(/filesystem/i);
    } finally {
      fs.chmodSync(root, 0o755);
    }
  });

  test('(f) bridge-connect rejection -> one device envelope (exit 2), not internal', async () => {
    const root = tmpRoot('mauto-b120-bridge-');
    const deviceBridgeFactory = async () => {
      throw Object.assign(new Error('mobile-mcp failed to spawn'), {
        hint: 'Ensure a device or simulator is connected.',
      });
    };
    const { program, calls } = captureProgram(root, { deviceBridgeFactory });

    await program.parseAsync(argv('elements'));

    expect(calls).toHaveLength(1);
    expect(calls[0].exitKind).toBe('device');
    expect(calls[0].envelope.ok).toBe(false);
    expect(calls[0].envelope.error.kind).toBe('device');
    expect(calls[0].envelope.error.message).toMatch(/spawn/);
  });

  test('(f2) bridge-connect rejection on an action verb (tap) -> device envelope', async () => {
    const root = tmpRoot('mauto-b120-bridge2-');
    const deviceBridgeFactory = async () => {
      throw new Error('no device connected');
    };
    const { program, calls } = captureProgram(root, { deviceBridgeFactory });

    await program.parseAsync(argv('tap', '--at', '10,20'));

    expect(calls).toHaveLength(1);
    expect(calls[0].exitKind).toBe('device');
    expect(calls[0].envelope.error.kind).toBe('device');
  });

  test('(g) bridge-connect rejection on devices list -> device envelope', async () => {
    const root = tmpRoot('mauto-b120-devs-');
    const deviceBridgeFactory = async () => {
      throw new Error('mobile-mcp unreachable');
    };
    const { program, calls } = captureProgram(root, { deviceBridgeFactory });

    await program.parseAsync(argv('devices'));

    expect(calls).toHaveLength(1);
    expect(calls[0].exitKind).toBe('device');
    expect(calls[0].envelope.error.kind).toBe('device');
  });

  test('success path still emits exactly one envelope (no double-emit through the boundary)', async () => {
    const root = tmpRoot('mauto-b120-ok-');
    const deviceBridgeFactory = async () => ({
      bridge: { listElements: async () => [] },
      close: async () => {},
    });
    const { program, calls } = captureProgram(root, { deviceBridgeFactory });

    await program.parseAsync(argv('elements'));

    expect(calls).toHaveLength(1);
    expect(calls[0].exitKind).toBe('ok');
    expect(calls[0].envelope.ok).toBe(true);
  });
});

// --- (b) the buildProgram-time escape: a throw BEFORE any action ------------
// The ScenarioValidator is constructed as a default param in buildProgram, so a
// corrupt bundled schema throws before parseAsync. Only run()'s outer guards can
// convert that into the envelope. We mock the validator to throw, then exercise
// run() with process.exit/stdout stubbed and assert exactly one JSON envelope.
describe('run() top-level boundary (#120 escape class b)', () => {
  test('a throw inside buildProgram yields one JSON envelope on stdout + mapped exit', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../../src/scenario/validator', () => ({
        ScenarioValidator: class {
          constructor() {
            throw new SyntaxError('Unexpected end of JSON input');
          }
        },
        DEFAULT_SCHEMA_PATH: '/nonexistent/schema.json',
      }));
      const cli = require('../../src/cli');

      const writes = [];
      const stdoutSpy = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation((s) => {
          writes.push(s);
          return true;
        });
      const exitCodes = [];
      const exitSpy = jest
        .spyOn(process, 'exit')
        .mockImplementation((code) => {
          exitCodes.push(code);
        });

      try {
        await cli.run(['node', 'mauto', 'elements']);
      } finally {
        stdoutSpy.mockRestore();
        exitSpy.mockRestore();
      }

      // Exactly one JSON line, parseable, ok:false, invalid_input, exit 3.
      const jsonLines = writes.filter((w) => w.trim().startsWith('{'));
      expect(jsonLines).toHaveLength(1);
      const env = JSON.parse(jsonLines[0]);
      expect(env.ok).toBe(false);
      expect(env.error.kind).toBe('invalid_input');
      expect(exitCodes).toEqual([3]);
    });
  });
});
