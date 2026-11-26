'use strict';

// showcase-app/ci/replay.sh is the generic replay step of the showcase CI
// workflow (#313): one `mauto run` per scenario, each classified by its exit
// code alone. These cases run the real script under bash against a fake
// `mauto` whose exit code is looked up by scenario basename, so every class
// is exercised without a device.

const fs = require('fs');
const path = require('path');

const { CI_DIR, describeIfBash, sandbox, runScript, cleanup } = require('./fake-mauto');

const SCRIPT = path.join(CI_DIR, 'replay.sh');

// Fake mauto: logs its argv (one line per call) and exits with the code
// mapped to the scenario's basename in codes.txt (default 0). It prints an
// extra engine-style line next to an envelope that claims success, so a
// script that parsed stdout would misclassify (#385).
const FAKE_MAUTO = `#!/usr/bin/env bash
dir="$(cd "$(dirname "$0")" && pwd)"
printf '%s\\n' "$*" >> "$dir/calls.txt"
name="$(basename "$2" .json)"
code="$(awk -v n="$name" '$1 == n { print $2 }' "$dir/codes.txt")"
echo "engine: some log line"
echo '{"ok":true,"data":{},"error":null,"hint":null,"schema_version":"1"}'
exit "\${code:-0}"
`;

function setup(codes) {
  const { root, bin, mauto } = sandbox('replay-sh-', FAKE_MAUTO);
  fs.writeFileSync(
    path.join(bin, 'codes.txt'),
    Object.entries(codes).map(([n, c]) => `${n} ${c}\n`).join(''),
  );
  const scenarios = Object.keys(codes).map((n) => {
    const file = path.join(root, 'scenarios', `${n}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{}');
    return file;
  });
  return { bin, mauto, scenarios, out: path.join(root, 'out'), summary: path.join(root, 'summary.md') };
}

function run(ctx, { args, env = {} } = {}) {
  const argv = args || ['emulator-5554', ctx.out, ...ctx.scenarios];
  const res = runScript('replay.sh', argv, {
    mauto: ctx.mauto,
    env: { GITHUB_STEP_SUMMARY: ctx.summary, ...env },
  });
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
  return {
    status: res.status,
    stdout: res.stdout,
    summary: read(ctx.summary),
    calls: read(path.join(ctx.bin, 'calls.txt')).split('\n').filter(Boolean),
    tsv: read(path.join(ctx.out, 'summary.tsv')).split('\n').filter(Boolean).map((l) => l.split('\t')),
  };
}

afterEach(cleanup);

describeIfBash('showcase-app/ci/replay.sh', () => {
  test('all scenarios pass: exit 0, a heading and one table row each, no annotations', () => {
    const ctx = setup({ alpha: 0, beta: 0 });
    const r = run(ctx);
    expect(r.status).toBe(0);
    expect(r.summary).toContain('### Replay on emulator-5554');
    expect(r.summary).toContain('| Scenario | Result | Exit |');
    expect(r.summary).toMatch(/\| alpha \| passed \| 0 \|/);
    expect(r.summary).toMatch(/\| beta \| passed \| 0 \|/);
    expect(r.stdout).not.toContain('::error');
    expect(r.tsv).toEqual([['alpha', 'passed', '0'], ['beta', 'passed', '0']]);
  });

  test('without GITHUB_STEP_SUMMARY the table goes to stdout', () => {
    const ctx = setup({ alpha: 0 });
    const r = run(ctx, { env: { GITHUB_STEP_SUMMARY: '' } });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('| Scenario | Result | Exit |');
    expect(r.stdout).toMatch(/\| alpha \| passed \| 0 \|/);
  });

  test('exit 6 with no probe is a scenario failure', () => {
    const ctx = setup({ alpha: 6 });
    const r = run(ctx);
    expect(r.status).toBe(1);
    expect(r.tsv).toEqual([['alpha', 'failed', '6']]);
    expect(r.stdout).toContain('::error title=Scenario failed::alpha: scenario failed: the app or the scenario');
    expect(r.summary).toMatch(/\| alpha \| scenario failed: the app or the scenario \| 6 \|/);
  });

  test('exit 6 with a failing probe is an outage', () => {
    const ctx = setup({ alpha: 6 });
    const r = run(ctx, { env: { REPLAY_PROBE: 'echo probing; exit 10' } });
    expect(r.status).toBe(1);
    expect(r.tsv).toEqual([['alpha', 'outage', '6']]);
    expect(r.stdout).toContain('::error title=Outage, not mauto::alpha: external service outage');
    expect(fs.readFileSync(path.join(ctx.out, 'logs', 'alpha.log'), 'utf8')).toContain('probing');
  });

  test('exit 6 with a passing probe is a scenario failure', () => {
    const ctx = setup({ alpha: 6 });
    const r = run(ctx, { env: { REPLAY_PROBE: 'true' } });
    expect(r.status).toBe(1);
    expect(r.tsv).toEqual([['alpha', 'failed', '6']]);
    expect(r.stdout).toContain('::error title=Scenario failed::alpha:');
  });

  test('the probe runs only after exit 6', () => {
    const ctx = setup({ alpha: 0, beta: 7, gamma: 2 });
    const marker = path.join(ctx.bin, 'probed');
    const r = run(ctx, { env: { REPLAY_PROBE: `touch '${marker}'; exit 1` } });
    expect(r.tsv.map((row) => row[1])).toEqual(['passed', 'needs_agent', 'mauto_error']);
    expect(fs.existsSync(marker)).toBe(false);
  });

  test('exit 7 needs an agent', () => {
    const ctx = setup({ alpha: 7 });
    const r = run(ctx);
    expect(r.status).toBe(1);
    expect(r.tsv).toEqual([['alpha', 'needs_agent', '7']]);
    expect(r.stdout).toContain('::error title=Needs agent::alpha: incomplete: a step or assertion needs an agent');
  });

  test.each([2, 5])('exit %i is a mauto or device error that shows the code', (code) => {
    const ctx = setup({ alpha: code });
    const r = run(ctx);
    expect(r.status).toBe(1);
    expect(r.tsv).toEqual([['alpha', 'mauto_error', String(code)]]);
    expect(r.stdout).toContain(`::error title=mauto or device error::alpha: mauto or device error (exit ${code})`);
    expect(r.summary).toContain(`(exit ${code}) | ${code} |`);
  });

  test('a mixed run continues past failures and runs every scenario', () => {
    const ctx = setup({ a: 2, b: 6, c: 0, d: 7, e: 0 });
    const r = run(ctx);
    expect(r.status).toBe(1);
    expect(r.calls).toHaveLength(5);
    expect(r.tsv).toEqual([
      ['a', 'mauto_error', '2'],
      ['b', 'failed', '6'],
      ['c', 'passed', '0'],
      ['d', 'needs_agent', '7'],
      ['e', 'passed', '0'],
    ]);
    expect(r.stdout.split('\n').filter((l) => l.startsWith('::error'))).toHaveLength(3);
  });

  test('passes run <file> --device <id> --junit <out>/junit/<name>.xml and creates the junit dir', () => {
    const ctx = setup({ alpha: 0 });
    const r = run(ctx);
    expect(r.calls).toEqual([
      `run ${ctx.scenarios[0]} --device emulator-5554 --junit ${ctx.out}/junit/alpha.xml`,
    ]);
    expect(fs.statSync(path.join(ctx.out, 'junit')).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(ctx.out, 'logs', 'alpha.log'), 'utf8')).toContain('engine: some log line');
  });

  test('no arguments is a usage error (exit 64)', () => {
    const ctx = setup({});
    const r = run(ctx, { args: [] });
    expect(r.status).toBe(64);
    expect(r.calls).toEqual([]);
  });

  test('a device and out dir but no scenarios is a usage error (exit 64)', () => {
    const ctx = setup({});
    const r = run(ctx, { args: ['emulator-5554', ctx.out] });
    expect(r.status).toBe(64);
  });

  test('the script stays generic and never names the retired replay gate', () => {
    const text = fs.readFileSync(SCRIPT, 'utf8');
    expect(text).not.toContain('MAUTO_' + 'REPLAY');
    expect(text).not.toMatch(/tmdb/i);
    expect(fs.statSync(SCRIPT).mode & 0o111).not.toBe(0);
  });
});
