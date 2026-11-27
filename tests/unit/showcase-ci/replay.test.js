'use strict';

// showcase-app/ci/replay.sh is the generic replay step of the showcase CI
// workflow (#313): one `mauto run` per scenario, each classified by its exit
// code alone, after one retry for any exit other than 0 and 7. These cases
// run the real script under bash against a fake `mauto` whose exit code is
// looked up by scenario basename (one per attempt), so every class is
// exercised without a device.

const fs = require('fs');
const path = require('path');

const { CI_DIR, describeIfBash, sandbox, runScript, cleanup } = require('./fake-mauto');

const SCRIPT = path.join(CI_DIR, 'replay.sh');

// Fake mauto: logs its argv (one line per call) and exits with the code
// mapped to the scenario's basename in codes.txt (default 0). A basename may
// map to a sequence of codes, one per attempt (the last repeats), so a retry
// can see a different exit from the first run. Each call writes its attempt
// number to stdout and to the --junit path, so tests can tell the attempts'
// files apart. It also prints an extra engine-style line next to an envelope
// that claims success, so a script that parsed stdout would misclassify (#385).
const FAKE_MAUTO = `#!/usr/bin/env bash
dir="$(cd "$(dirname "$0")" && pwd)"
printf '%s\\n' "$*" >> "$dir/calls.txt"
name="$(basename "$2" .json)"
count="$(cat "$dir/count.$name" 2>/dev/null || echo 0)"
count=$((count + 1))
echo "$count" > "$dir/count.$name"
code="$(awk -v n="$name" -v i="$count" '$1 == n { if (i + 1 > NF) i = NF - 1; print $(i + 1) }' "$dir/codes.txt")"
printf 'attempt %s\\n' "$count" > "$6"
echo "engine: some log line"
echo "attempt $count"
echo '{"ok":true,"data":{},"error":null,"hint":null,"schema_version":"1"}'
exit "\${code:-0}"
`;

function setup(codes) {
  const { root, bin, mauto } = sandbox('replay-sh-', FAKE_MAUTO);
  fs.writeFileSync(
    path.join(bin, 'codes.txt'),
    Object.entries(codes).map(([n, c]) => `${n} ${[].concat(c).join(' ')}\n`).join(''),
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
    read,
  };
}

afterEach(cleanup);

// The classification cases pin one attempt each (REPLAY_RETRIES=0); the
// retry cases below run with the default.
const ONCE = { REPLAY_RETRIES: '0' };

describeIfBash('showcase-app/ci/replay.sh', () => {
  test('all scenarios pass: exit 0, a heading and one table row each, no annotations', () => {
    const ctx = setup({ alpha: 0, beta: 0 });
    const r = run(ctx);
    expect(r.status).toBe(0);
    expect(r.summary).toContain('### Replay on emulator-5554');
    expect(r.summary).toContain('| Scenario | Result | Exit | Attempts |');
    expect(r.summary).toMatch(/\| alpha \| passed \| 0 \| 1 \|/);
    expect(r.summary).toMatch(/\| beta \| passed \| 0 \| 1 \|/);
    expect(r.stdout).not.toContain('::error');
    expect(r.stdout).not.toContain('::warning');
    expect(r.calls).toHaveLength(2);
    expect(r.tsv).toEqual([['alpha', 'passed', '0', '1'], ['beta', 'passed', '0', '1']]);
  });

  test('without GITHUB_STEP_SUMMARY the table goes to stdout', () => {
    const ctx = setup({ alpha: 0 });
    const r = run(ctx, { env: { GITHUB_STEP_SUMMARY: '' } });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('| Scenario | Result | Exit | Attempts |');
    expect(r.stdout).toMatch(/\| alpha \| passed \| 0 \| 1 \|/);
  });

  test('exit 6 with no probe is a scenario failure', () => {
    const ctx = setup({ alpha: 6 });
    const r = run(ctx, { env: ONCE });
    expect(r.status).toBe(1);
    expect(r.tsv).toEqual([['alpha', 'failed', '6', '1']]);
    expect(r.stdout).toContain('::error title=Scenario failed::alpha: scenario failed: the app or the scenario\n');
    expect(r.summary).toMatch(/\| alpha \| scenario failed: the app or the scenario \| 6 \| 1 \|/);
  });

  test('exit 6 with a failing probe is an outage', () => {
    const ctx = setup({ alpha: 6 });
    const r = run(ctx, { env: { ...ONCE, REPLAY_PROBE: 'echo probing; exit 10' } });
    expect(r.status).toBe(1);
    expect(r.tsv).toEqual([['alpha', 'outage', '6', '1']]);
    expect(r.stdout).toContain('::error title=Outage (not mauto)::alpha: external service outage');
    expect(fs.readFileSync(path.join(ctx.out, 'logs', 'alpha.log'), 'utf8')).toContain('probing');
  });

  test('exit 6 with a passing probe is a scenario failure', () => {
    const ctx = setup({ alpha: 6 });
    const r = run(ctx, { env: { ...ONCE, REPLAY_PROBE: 'true' } });
    expect(r.status).toBe(1);
    expect(r.tsv).toEqual([['alpha', 'failed', '6', '1']]);
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
    const r = run(ctx, { env: ONCE });
    expect(r.status).toBe(1);
    expect(r.tsv).toEqual([['alpha', 'needs_agent', '7', '1']]);
    expect(r.stdout).toContain('::error title=Needs agent::alpha: incomplete: a step or assertion needs an agent');
  });

  test.each([2, 5])('exit %i is a mauto or device error that shows the code', (code) => {
    const ctx = setup({ alpha: code });
    const r = run(ctx, { env: ONCE });
    expect(r.status).toBe(1);
    expect(r.tsv).toEqual([['alpha', 'mauto_error', String(code), '1']]);
    expect(r.stdout).toContain(`::error title=mauto or device error::alpha: mauto or device error (exit ${code})\n`);
    expect(r.summary).toContain(`(exit ${code}) | ${code} | 1 |`);
  });

  test('a mixed run continues past failures and runs every scenario', () => {
    const ctx = setup({ a: 2, b: 6, c: 0, d: 7, e: 0 });
    const r = run(ctx);
    expect(r.status).toBe(1);
    // a and b are retried once; d (exit 7) is not.
    expect(r.calls).toHaveLength(7);
    expect(r.tsv).toEqual([
      ['a', 'mauto_error', '2', '2'],
      ['b', 'failed', '6', '2'],
      ['c', 'passed', '0', '1'],
      ['d', 'needs_agent', '7', '1'],
      ['e', 'passed', '0', '1'],
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

  describe('retry once', () => {
    test.each([2, 6])('exit %i then 0 is flaky: a warning, not a failure, and two invocations', (first) => {
      const ctx = setup({ alpha: [first, 0] });
      const r = run(ctx, { env: { REPLAY_PROBE: 'exit 1' } });
      expect(r.status).toBe(0);
      expect(r.calls).toHaveLength(2);
      expect(r.calls[1]).toBe(r.calls[0]);
      expect(r.tsv).toEqual([['alpha', 'flaky', '0', '2']]);
      expect(r.stdout).toContain(`::warning title=Flaky (passed on retry)::alpha: first attempt exit ${first}\n`);
      expect(r.stdout).not.toContain('::error');
      expect(r.summary).toMatch(/\| alpha \| passed on retry \(flaky\) \| 0 \| 2 \|/);
    });

    test('a flaky scenario does not fail a run whose other scenarios pass', () => {
      const ctx = setup({ alpha: 0, beta: [2, 0], gamma: 0 });
      const r = run(ctx);
      expect(r.status).toBe(0);
      expect(r.tsv.map((row) => row[1])).toEqual(['passed', 'flaky', 'passed']);
    });

    test('each attempt keeps its own log and junit; the final junit is at the usual path', () => {
      const ctx = setup({ alpha: [2, 0] });
      run(ctx);
      const logs = path.join(ctx.out, 'logs');
      const junit = path.join(ctx.out, 'junit');
      expect(fs.readFileSync(path.join(logs, 'alpha.log'), 'utf8')).toContain('attempt 1');
      expect(fs.readFileSync(path.join(logs, 'alpha.retry.log'), 'utf8')).toContain('attempt 2');
      expect(fs.readFileSync(path.join(junit, 'alpha.attempt1.xml'), 'utf8')).toBe('attempt 1\n');
      expect(fs.readFileSync(path.join(junit, 'alpha.xml'), 'utf8')).toBe('attempt 2\n');
    });

    test('a scenario that passes first time leaves no retry log or attempt1 junit', () => {
      const ctx = setup({ alpha: 0 });
      run(ctx);
      expect(fs.existsSync(path.join(ctx.out, 'logs', 'alpha.retry.log'))).toBe(false);
      expect(fs.existsSync(path.join(ctx.out, 'junit', 'alpha.attempt1.xml'))).toBe(false);
    });

    test('fails twice: classified by the second exit, both exits reported', () => {
      const ctx = setup({ alpha: [6, 2] });
      const r = run(ctx, { env: { REPLAY_PROBE: 'exit 1' } });
      expect(r.status).toBe(1);
      expect(r.calls).toHaveLength(2);
      expect(r.tsv).toEqual([['alpha', 'mauto_error', '2', '2']]);
      expect(r.stdout).toContain(
        '::error title=mauto or device error::alpha: mauto or device error (exit 2) (first attempt exit 6)\n',
      );
      expect(r.summary).toMatch(/\| alpha \| mauto or device error \(exit 2\) \(first attempt exit 6\) \| 2 \| 2 \|/);
    });

    test('fails twice with exit 6 last: the probe classifies it, once, into the retry log', () => {
      const ctx = setup({ alpha: [2, 6] });
      const r = run(ctx, { env: { REPLAY_PROBE: 'echo probing; exit 10' } });
      expect(r.status).toBe(1);
      expect(r.tsv).toEqual([['alpha', 'outage', '6', '2']]);
      expect(r.stdout).toContain('::error title=Outage (not mauto)::alpha: external service outage (first attempt exit 2)');
      const logs = path.join(ctx.out, 'logs');
      expect(fs.readFileSync(path.join(logs, 'alpha.retry.log'), 'utf8').match(/^probing$/gm)).toHaveLength(1);
      expect(fs.readFileSync(path.join(logs, 'alpha.log'), 'utf8')).not.toContain('probing');
    });

    test('the probe does not run for a first-attempt exit 6 that is retried', () => {
      const ctx = setup({ alpha: [6, 0], beta: [6, 2] });
      const marker = path.join(ctx.bin, 'probed');
      const r = run(ctx, { env: { REPLAY_PROBE: `touch '${marker}'; exit 1` } });
      expect(r.tsv.map((row) => row[1])).toEqual(['flaky', 'mauto_error']);
      expect(fs.existsSync(marker)).toBe(false);
    });

    test('exit 7 is never retried', () => {
      const ctx = setup({ alpha: [7, 0] });
      const r = run(ctx);
      expect(r.status).toBe(1);
      expect(r.calls).toHaveLength(1);
      expect(r.tsv).toEqual([['alpha', 'needs_agent', '7', '1']]);
    });

    test('REPLAY_RETRIES=0 runs each scenario once, as before', () => {
      const ctx = setup({ alpha: [2, 0] });
      const r = run(ctx, { env: ONCE });
      expect(r.status).toBe(1);
      expect(r.calls).toHaveLength(1);
      expect(r.tsv).toEqual([['alpha', 'mauto_error', '2', '1']]);
      expect(fs.existsSync(path.join(ctx.out, 'logs', 'alpha.retry.log'))).toBe(false);
    });

    test.each(['2', 'yes', '-1'])('REPLAY_RETRIES=%s is a usage error (exit 64)', (value) => {
      const ctx = setup({ alpha: 0 });
      const r = run(ctx, { env: { REPLAY_RETRIES: value } });
      expect(r.status).toBe(64);
      expect(r.calls).toEqual([]);
    });
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
