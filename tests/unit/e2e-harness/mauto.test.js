'use strict';

const { createMauto, MautoError } = require('../../../sample-app/scripts/lib/mauto');

// A fake exec that records each invocation and answers with a canned process
// outcome: { stdout, stderr, code }.
function fakeExec(outcome) {
  const calls = [];
  const exec = (file, args, options) => {
    calls.push({ file, args, options });
    return Promise.resolve(typeof outcome === 'function' ? outcome(args) : outcome);
  };
  return { exec, calls };
}

const envelope = (body) => JSON.stringify({ schema_version: '1', ...body });

describe('createMauto().run', () => {
  test('returns data from an ok envelope and passes bin, args and cwd through', async () => {
    const { exec, calls } = fakeExec({ stdout: envelope({ ok: true, data: [{ text: 'x' }] }), stderr: '', code: 0 });
    const mauto = createMauto({ bin: '/x/mauto', cwd: '/proj', exec });
    await expect(mauto.run(['elements'])).resolves.toEqual([{ text: 'x' }]);
    expect(calls[0].file).toBe('/x/mauto');
    expect(calls[0].args).toEqual(['elements']);
    expect(calls[0].options.cwd).toBe('/proj');
  });

  test('always disables engine telemetry and merges per-call env', async () => {
    const { exec, calls } = fakeExec({ stdout: envelope({ ok: true, data: null }), stderr: '', code: 0 });
    const mauto = createMauto({ bin: 'mauto', cwd: '/p', env: { BASE: '1' }, exec });
    await mauto.run(['launch', 'a.b'], { env: { MAUTO_RUN_ID: 'run_20260101_000000' } });
    const env = calls[0].options.env;
    expect(env.MOBILEMCP_DISABLE_TELEMETRY).toBe('1');
    expect(env.BASE).toBe('1');
    expect(env.MAUTO_RUN_ID).toBe('run_20260101_000000');
  });

  test('scrubs MOBILEMCP_LEGACY_ROBOT so the engine comes from the workspace config (#251)', async () => {
    const saved = process.env.MOBILEMCP_LEGACY_ROBOT;
    process.env.MOBILEMCP_LEGACY_ROBOT = '1';
    try {
      const { exec, calls } = fakeExec({ stdout: envelope({ ok: true, data: null }), stderr: '', code: 0 });
      const mauto = createMauto({ bin: 'mauto', cwd: '/p', env: { MOBILEMCP_LEGACY_ROBOT: '1' }, exec });
      await mauto.run(['elements'], { env: { MOBILEMCP_LEGACY_ROBOT: '1' } });
      expect(Object.prototype.hasOwnProperty.call(calls[0].options.env, 'MOBILEMCP_LEGACY_ROBOT')).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.MOBILEMCP_LEGACY_ROBOT;
      else process.env.MOBILEMCP_LEGACY_ROBOT = saved;
    }
  });

  test('ok:false throws a MautoError naming the verb, error, hint and stderr tail', async () => {
    const { exec } = fakeExec({
      stdout: envelope({ ok: false, error: { kind: 'device', message: 'no device' }, hint: 'connect one' }),
      stderr: 'line1\nline2 daemon died',
      code: 4,
    });
    const mauto = createMauto({ bin: 'mauto', cwd: '/p', exec });
    const err = await mauto.run(['tap', '--at', '1,2']).catch((e) => e);
    expect(err).toBeInstanceOf(MautoError);
    expect(err.verb).toBe('tap');
    expect(err.message).toContain('mauto tap');
    expect(err.message).toContain('no device');
    expect(err.message).toContain('connect one');
    expect(err.message).toContain('daemon died');
  });

  test('names the subcommand for nested verbs', async () => {
    const { exec } = fakeExec({ stdout: envelope({ ok: false, error: { kind: 'x', message: 'bad' } }), stderr: '', code: 2 });
    const mauto = createMauto({ bin: 'mauto', cwd: '/p', exec });
    const err = await mauto.run(['result', 'add-step', '--run-id', 'r']).catch((e) => e);
    expect(err.verb).toBe('result add-step');
  });

  test('unparseable stdout throws rather than returning undefined', async () => {
    const { exec } = fakeExec({ stdout: 'Segmentation fault', stderr: 'boom', code: 0 });
    const mauto = createMauto({ bin: 'mauto', cwd: '/p', exec });
    const err = await mauto.run(['elements']).catch((e) => e);
    expect(err).toBeInstanceOf(MautoError);
    expect(err.message).toMatch(/not a JSON envelope/);
    expect(err.message).toContain('Segmentation fault');
  });

  test('a non-zero exit with an ok envelope is still a failure', async () => {
    const { exec } = fakeExec({ stdout: envelope({ ok: true, data: [] }), stderr: '', code: 1 });
    const mauto = createMauto({ bin: 'mauto', cwd: '/p', exec });
    await expect(mauto.run(['elements'])).rejects.toThrow(/exited 1/);
  });

  // #273: a failed `mauto assert` and the finalize of a failed run exit 6 with
  // `test_failed` and the verdict / result in data. That is the answer the
  // caller asked for, so a caller that opts in gets the data back.
  describe('acceptKinds', () => {
    const failedVerdict = { type: 'element_text', mechanical: true, pass: false, needs_agent: false, message: 'text is X' };
    const testFailed = (extra = {}) =>
      envelope({ ok: false, error: { kind: 'test_failed', message: 'assertion failed: text is X' }, hint: 'h', ...extra });

    test('an accepted kind with a non-zero exit and data returns the data', async () => {
      const { exec } = fakeExec({ stdout: testFailed({ data: failedVerdict }), stderr: '', code: 6 });
      const mauto = createMauto({ bin: 'mauto', cwd: '/p', exec });
      await expect(mauto.run(['assert', 'element_text'], { acceptKinds: ['test_failed'] })).resolves.toEqual(failedVerdict);
    });

    test('a kind not in acceptKinds still throws', async () => {
      const { exec } = fakeExec({
        stdout: envelope({ ok: false, error: { kind: 'device', message: 'no device' }, data: null }),
        stderr: '',
        code: 2,
      });
      const mauto = createMauto({ bin: 'mauto', cwd: '/p', exec });
      const err = await mauto.run(['assert', 'element_text'], { acceptKinds: ['test_failed'] }).catch((e) => e);
      expect(err).toBeInstanceOf(MautoError);
      expect(err.message).toContain('no device');
    });

    test('an accepted kind that exited 0 is a contract bug and throws', async () => {
      const { exec } = fakeExec({ stdout: testFailed({ data: failedVerdict }), stderr: '', code: 0 });
      const mauto = createMauto({ bin: 'mauto', cwd: '/p', exec });
      const err = await mauto.run(['assert', 'element_text'], { acceptKinds: ['test_failed'] }).catch((e) => e);
      expect(err).toBeInstanceOf(MautoError);
      expect(err.message).toMatch(/test_failed/);
      expect(err.message).toMatch(/exited 0/);
    });

    test('an accepted kind with no data key is a contract bug and throws', async () => {
      const { exec } = fakeExec({ stdout: testFailed(), stderr: '', code: 6 });
      const mauto = createMauto({ bin: 'mauto', cwd: '/p', exec });
      const err = await mauto.run(['result', 'finalize'], { acceptKinds: ['test_failed'] }).catch((e) => e);
      expect(err).toBeInstanceOf(MautoError);
      expect(err.verb).toBe('result finalize');
      expect(err.message).toMatch(/no data/);
    });

    test('without acceptKinds a test_failed envelope throws as before', async () => {
      const { exec } = fakeExec({ stdout: testFailed({ data: failedVerdict }), stderr: '', code: 6 });
      const mauto = createMauto({ bin: 'mauto', cwd: '/p', exec });
      const err = await mauto.run(['assert', 'element_text']).catch((e) => e);
      expect(err).toBeInstanceOf(MautoError);
      expect(err.message).toContain('mauto assert failed');
      expect(err.message).toContain('test_failed');
    });
  });

  test('logs each invocation', async () => {
    const lines = [];
    const { exec } = fakeExec({ stdout: envelope({ ok: true, data: 1 }), stderr: '', code: 0 });
    const mauto = createMauto({ bin: 'mauto', cwd: '/p', exec, log: (l) => lines.push(l) });
    await mauto.run(['type', 'zzzz']);
    expect(lines.join('\n')).toContain('mauto type zzzz');
  });
});
