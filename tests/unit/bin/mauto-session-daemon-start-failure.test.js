'use strict';

// A daemon start that fails is reported in .session/daemon.log, the daemon's
// stderr, which is where a verb whose daemon never became ready sends the user
// (#346). A refusal's hint says what to do, so it must reach that log too, on
// the line after the message.
//
// The real bin is spawned: the top-level catch only runs under
// `require.main === module`. The start fails in ensureSessionDirs, before any
// engine exists, so no device is touched. The project root is deep enough that
// its socket falls back to <TMPDIR>/mauto-<uid>, here (TMPDIR pointed into
// this test's own temp dir) a 0755 directory, which is refused not_private.

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeStartFailure } = require('../../../bin/mauto-session-daemon');
const { UnsafePathError } = require('../../../src/workspace/safe-fs');

const BIN = path.resolve(__dirname, '../../../bin/mauto-session-daemon.js');

let base;
beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-daemon-fail-')));
});
afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe('writeStartFailure', () => {
  test('writes the message, then the hint on its own line', () => {
    const lines = [];
    writeStartFailure(new UnsafePathError('/x/mauto', 'world_writable'), (t) => lines.push(t));
    expect(lines).toEqual([
      'mauto-session-daemon: Refusing to use workspace path /x/mauto: it is writable by every user (world_writable).\n',
      expect.stringMatching(/^mauto-session-daemon: hint: .*chmod o-w <path>.*\n$/),
    ]);
  });

  test('an error without a hint writes the message alone', () => {
    const lines = [];
    writeStartFailure(new Error('boom'), (t) => lines.push(t));
    expect(lines).toEqual(['mauto-session-daemon: boom\n']);
  });
});

describe('bin/mauto-session-daemon start failure', () => {
  test('a refused socket directory exits 1 with its message and hint on stderr', () => {
    const root = path.join(base, 'd'.repeat(80));
    fs.mkdirSync(root);
    const tmp = path.join(base, 'tmp');
    const sockDir = path.join(tmp, `mauto-${process.getuid()}`);
    fs.mkdirSync(sockDir, { recursive: true });
    fs.chmodSync(sockDir, 0o755);

    const r = childProcess.spawnSync(process.execPath, [BIN], {
      cwd: root,
      encoding: 'utf8',
      timeout: 15000,
      env: {
        PATH: process.env.PATH,
        HOME: base,
        MAUTO_SESSION_PROJECT_ROOT: root,
        TMPDIR: tmp,
        MAUTO_LOG_DIR: path.join(base, 'logs'),
        MAUTO_TELEMETRY: '0',
        DO_NOT_TRACK: '1',
      },
    });

    expect(r.status).toBe(1);
    expect(r.stderr).toContain(
      `mauto-session-daemon: Refusing to use session socket directory ${sockDir}: other users can access it (not_private).\n` +
        "mauto-session-daemon: hint: Other users could reach the device session's socket through it."
    );
    // Refused, never repaired.
    expect(fs.lstatSync(sockDir).mode & 0o777).toBe(0o755);
  });
});
