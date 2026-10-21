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

  test('logs each invocation', async () => {
    const lines = [];
    const { exec } = fakeExec({ stdout: envelope({ ok: true, data: 1 }), stderr: '', code: 0 });
    const mauto = createMauto({ bin: 'mauto', cwd: '/p', exec, log: (l) => lines.push(l) });
    await mauto.run(['type', 'zzzz']);
    expect(lines.join('\n')).toContain('mauto type zzzz');
  });
});
