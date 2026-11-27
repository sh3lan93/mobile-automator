'use strict';

// showcase-app/ci/device-id.sh resolves the id `mauto run --device` needs from
// `mauto devices` (#313), so the workflow YAML carries no jq over the
// envelope. These cases run the real script under bash against a fake `mauto`
// that prints a canned stdout and exits with a canned code.

const fs = require('fs');
const path = require('path');

const { CI_DIR, describeIfBash, sandbox, runScript, cleanup } = require('./fake-mauto');

const SCRIPT = path.join(CI_DIR, 'device-id.sh');

const DEVICES = [
  { id: 'Pixel_9_Pro', name: 'Pixel 9 Pro', platform: 'android', state: 'online' },
  { id: 'ADD7C4A6-0000-4000-8000-000000000001', name: 'iPhone 17 Pro', platform: 'ios', state: 'online' },
];

const envelope = (data, ok = true) =>
  JSON.stringify(ok ? { ok, data, schema_version: '2.1' } : { ok, data: null, error: { kind: 'device' }, schema_version: '2.1' });

// Fake mauto: logs its argv, prints stdout.txt verbatim and exits with exit.txt (default 0).
const FAKE_MAUTO = `#!/usr/bin/env bash
dir="$(cd "$(dirname "$0")" && pwd)"
printf '%s\\n' "$*" >> "$dir/calls.txt"
cat "$dir/stdout.txt"
code="$(cat "$dir/exit.txt" 2>/dev/null)"
exit "\${code:-0}"
`;

function run(args, { stdout = envelope(DEVICES), exit = 0 } = {}) {
  const { bin, mauto } = sandbox('device-id-sh-', FAKE_MAUTO);
  fs.writeFileSync(path.join(bin, 'stdout.txt'), `${stdout}\n`);
  fs.writeFileSync(path.join(bin, 'exit.txt'), String(exit));
  const res = runScript('device-id.sh', args, { mauto });
  const calls = path.join(bin, 'calls.txt');
  return { ...res, calls: fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean) : [] };
}

afterEach(cleanup);

describeIfBash('showcase-app/ci/device-id.sh', () => {
  test('android prints the Android device id (the AVD name), from `mauto devices`', () => {
    const r = run(['android']);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('Pixel_9_Pro\n');
    expect(r.calls).toEqual(['devices']);
  });

  test('ios prints the simulator UDID', () => {
    const r = run(['ios']);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`${DEVICES[1].id}\n`);
  });

  test('picks the first device of the platform', () => {
    const r = run(['android'], {
      stdout: envelope([DEVICES[1], { ...DEVICES[0], id: 'first' }, { ...DEVICES[0], id: 'second' }]),
    });
    expect(r.stdout).toBe('first\n');
  });

  test('engine debug lines before the envelope are ignored (#385)', () => {
    const r = run(['android'], {
      stdout: `engine: starting\n{not the envelope\n${envelope(DEVICES)}`,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('Pixel_9_Pro\n');
  });

  test('the platform matches case-insensitively, both in the envelope and the argument', () => {
    const upper = DEVICES.map((d) => ({ ...d, platform: d.platform === 'ios' ? 'iOS' : 'Android' }));
    expect(run(['ios'], { stdout: envelope(upper) }).stdout).toBe(`${DEVICES[1].id}\n`);
    expect(run(['Android'], { stdout: envelope(upper) }).stdout).toBe('Pixel_9_Pro\n');
  });

  test('no device of the platform: exit 1 with an annotation', () => {
    const r = run(['ios'], { stdout: envelope([DEVICES[0]]) });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('::error title=No ios device::');
  });

  test('an empty device list: exit 1', () => {
    const r = run(['android'], { stdout: envelope([]) });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('::error title=No android device::');
  });

  test('an ok:false envelope: exit 1 with an annotation', () => {
    const r = run(['android'], { stdout: envelope(null, false), exit: 2 });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('::error title=mauto devices failed::');
  });

  test('no envelope at all: exit 1', () => {
    const r = run(['android'], { stdout: 'engine: crashed', exit: 1 });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
  });

  test.each([[[]], [['android', 'ios']], [['windows']]])('bad usage %j: exit 64 without calling mauto', (args) => {
    const r = run(args);
    expect(r.status).toBe(64);
    expect(r.calls).toEqual([]);
  });

  test('the script stays generic and executable', () => {
    const text = fs.readFileSync(SCRIPT, 'utf8');
    expect(text).not.toMatch(/tmdb|showcase/i);
    expect(fs.statSync(SCRIPT).mode & 0o111).not.toBe(0);
  });
});
