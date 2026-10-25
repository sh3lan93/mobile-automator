'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const paths = require('../../../src/device/session-paths');

describe('session-paths', () => {
  const root = '/tmp/proj';

  test('all paths live under <root>/mobile-automator/.session/', () => {
    const base = path.join(root, 'mobile-automator', '.session');
    expect(paths.sessionDir(root)).toBe(base);
    expect(paths.socketPath(root).startsWith(base + path.sep)).toBe(true);
    expect(paths.pidFilePath(root).startsWith(base + path.sep)).toBe(true);
    expect(paths.handlePath(root).startsWith(base + path.sep)).toBe(true);
  });

  test('socket / pid / handle names are distinct', () => {
    const names = new Set([
      paths.socketPath(root),
      paths.pidFilePath(root),
      paths.handlePath(root),
    ]);
    expect(names.size).toBe(3);
  });

  test('paths are project-root relative', () => {
    expect(paths.sessionDir('/a')).not.toBe(paths.sessionDir('/b'));
  });

  test('logFilePath resolves to <root>/mobile-automator/.session/daemon.log', () => {
    expect(paths.logFilePath(root)).toBe(
      path.join(root, 'mobile-automator', '.session', 'daemon.log')
    );
    expect(paths.LOG_NAME).toBe('daemon.log');
  });

  test('logFilePath stays in the workspace even where socketPath falls back to tmpdir', () => {
    // A root long enough that the in-workspace socket path exceeds the
    // sockaddr length limit. That limit is a socket-only constraint, so the
    // log file must NOT follow the socket out to os.tmpdir().
    const deepRoot = '/' + 'deeply-nested-project-dir/'.repeat(6) + 'app';
    expect(paths.socketPath(deepRoot)).not.toBe(paths.workspaceSocketPath(deepRoot));
    expect(paths.socketPath(deepRoot).startsWith(os.tmpdir())).toBe(true);

    expect(paths.logFilePath(deepRoot)).toBe(
      path.join(paths.sessionDir(deepRoot), 'daemon.log')
    );
  });
});

// #156: `session end` signals a process only when its command line names THIS
// workspace. #236: it names it by a SALTED digest, because `ps` shows argv to
// every user on the host and a project path can name a client or project. An
// unsalted digest of a path is confirmable: guess the path, hash it, compare.
describe('daemon workspace marker (#156, #236)', () => {
  const sha16 = (r) => crypto.createHash('sha1').update(path.resolve(r)).digest('hex').slice(0, 16);
  const SALT = 'a'.repeat(64);
  const OTHER_SALT = 'b'.repeat(64);
  const cmd = (r, salt = SALT) => `node /x/bin/mauto-session-daemon.js ${paths.daemonArgv(r, salt).join(' ')}`;
  const legacy = (r) => `node /x/bin/mauto-session-daemon.js --project-root ${r}`;

  test('daemonMarkerKey is HMAC-SHA256(salt, resolved root), 16 hex chars, deterministic', () => {
    const key = paths.daemonMarkerKey('/a/proj/', SALT);
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(key).toBe(paths.daemonMarkerKey('/a/proj', SALT));
    expect(key).toBe(crypto.createHmac('sha256', SALT).update(path.resolve('/a/proj')).digest('hex').slice(0, 16));
  });

  test('daemonMarkerKey differs per salt and per root, and is not the unsalted digest', () => {
    expect(paths.daemonMarkerKey('/a/proj', SALT)).not.toBe(paths.daemonMarkerKey('/a/proj', OTHER_SALT));
    expect(paths.daemonMarkerKey('/a/proj', SALT)).not.toBe(paths.daemonMarkerKey('/b/other', SALT));
    expect(paths.daemonMarkerKey('/a/proj', SALT)).not.toBe(sha16('/a/proj'));
  });

  test('daemonArgv names the workspace by a salted key, never its path', () => {
    const argv = paths.daemonArgv('/a/proj/', SALT);
    expect(argv).toEqual(['--workspace-key', paths.daemonMarkerKey('/a/proj', SALT)]);
    expect(argv).toEqual(paths.daemonArgv('/a/proj', SALT));
    for (const arg of argv) {
      expect(arg).not.toContain('proj');
      expect(arg).not.toContain('/a');
    }
    // Nor the unsalted digest anyone can compute from a guessed path.
    expect(argv).not.toContain(sha16('/a/proj'));
  });

  test('the salt lives in the session dir, beside daemon.pid', () => {
    expect(paths.SALT_NAME).toBe('marker.salt');
    expect(paths.saltPath('/a/proj')).toBe(path.join(paths.sessionDir('/a/proj'), 'marker.salt'));
  });

  test('the tmpdir socket fallback is still named by the same, unchanged digest', () => {
    // A running daemon is bound to this path; salting the marker must not move it.
    const deepRoot = '/' + 'deeply-nested-project-dir/'.repeat(6) + 'app';
    const base = path.basename(paths.socketPath(deepRoot));
    expect(base).toBe(`mauto-${paths.workspaceKey(deepRoot)}.sock`);
    expect(base).toBe(`mauto-${sha16(deepRoot)}.sock`);
  });

  test("commandNamesWorkspace matches this workspace's salted key at the end of the line", () => {
    expect(paths.commandNamesWorkspace(cmd('/a/proj'), '/a/proj', SALT)).toBe(true);
    // ps output ends in a newline; a root may be spelled with a trailing slash.
    expect(paths.commandNamesWorkspace(`${cmd('/a/proj')}\n`, '/a/proj/', SALT)).toBe(true);
  });

  test('commandNamesWorkspace never matches another salt, no salt, another root, a mangled key, or a bare daemon', () => {
    expect(paths.commandNamesWorkspace(cmd('/a/proj'), '/a/proj', OTHER_SALT)).toBe(false);
    expect(paths.commandNamesWorkspace(cmd('/a/proj'), '/a/proj', null)).toBe(false);
    expect(paths.commandNamesWorkspace(cmd('/a/proj'), '/a/proj')).toBe(false);
    expect(paths.commandNamesWorkspace(cmd('/b/other'), '/a/proj', SALT)).toBe(false);
    const key = paths.daemonMarkerKey('/a/proj', SALT);
    const line = (k) => `node /x/bin/mauto-session-daemon.js --workspace-key ${k}`;
    expect(paths.commandNamesWorkspace(line(`${key}0`), '/a/proj', SALT)).toBe(false);
    expect(paths.commandNamesWorkspace(line(key.slice(1)), '/a/proj', SALT)).toBe(false);
    // The unsalted digest the never-released format used is not a marker.
    expect(paths.commandNamesWorkspace(line(sha16('/a/proj')), '/a/proj', SALT)).toBe(false);
    // A pre-marker daemon, or an editor opened on the bin, names no workspace.
    expect(paths.commandNamesWorkspace('node /x/bin/mauto-session-daemon.js', '/a/proj', SALT)).toBe(false);
    expect(paths.commandNamesWorkspace('vim bin/mauto-session-daemon.js', '/a/proj', SALT)).toBe(false);
  });

  test('a legacy --project-root daemon (0.28.0-0.35.0) is still recognised, end-anchored, salt or not', () => {
    expect(paths.LEGACY_DAEMON_ROOT_FLAG).toBe('--project-root');
    for (const salt of [SALT, null]) {
      expect(paths.commandNamesWorkspace(legacy('/a/proj'), '/a/proj', salt)).toBe(true);
      expect(paths.commandNamesWorkspace(`${legacy('/a/proj')}\n`, '/a/proj/', salt)).toBe(true);
      expect(paths.commandNamesWorkspace(legacy('/a/proj2'), '/a/proj', salt)).toBe(false);
      expect(paths.commandNamesWorkspace(legacy('/b/a/proj'), '/a/proj', salt)).toBe(false);
    }
  });

  // #237: a daemon started by mauto <= 0.27.x carries no marker at all. Telling
  // "names no workspace" apart from "names ANOTHER workspace" is what lets
  // `session end` recognise the former by its socket and lock instead.
  test('commandHasWorkspaceMarker is true for either marker flag, whichever workspace it names (#237)', () => {
    expect(paths.commandHasWorkspaceMarker(cmd('/a/proj'))).toBe(true);
    expect(paths.commandHasWorkspaceMarker(cmd('/b/other', OTHER_SALT))).toBe(true);
    expect(paths.commandHasWorkspaceMarker(legacy('/a/proj'))).toBe(true);
    expect(paths.commandHasWorkspaceMarker(`${legacy('/b/other')}\n`)).toBe(true);
    // A flag is a marker even with a value nobody can match (a mangled key).
    expect(paths.commandHasWorkspaceMarker('node /x/bin/mauto-session-daemon.js --workspace-key zz')).toBe(true);
  });

  test('commandHasWorkspaceMarker is false for a pre-marker daemon and matches whole argv tokens only (#237)', () => {
    expect(paths.commandHasWorkspaceMarker('node /x/bin/mauto-session-daemon.js')).toBe(false);
    expect(paths.commandHasWorkspaceMarker('node /x/bin/mauto-session-daemon.js\n')).toBe(false);
    expect(paths.commandHasWorkspaceMarker('vim bin/mauto-session-daemon.js')).toBe(false);
    expect(paths.commandHasWorkspaceMarker('')).toBe(false);
    expect(paths.commandHasWorkspaceMarker(null)).toBe(false);
    // A flag-shaped substring inside another token is not the flag.
    expect(paths.commandHasWorkspaceMarker('node /x/--workspace-key/bin/mauto-session-daemon.js')).toBe(false);
    expect(paths.commandHasWorkspaceMarker('node /x/bin/mauto-session-daemon.js --project-root-x /a')).toBe(false);
    expect(paths.commandHasWorkspaceMarker('node /x/bin/mauto-session-daemon.js x--workspace-key k')).toBe(false);
  });
});

// #236: `ps` shows every process's argv to every user on the host, so an
// in-project absolute path (the daemon bin, the engine entry, mobilecli) would
// put the project path on the command line. The child runs with cwd = root,
// so the path relative to the root reaches the same file.
describe('argvPath (#236)', () => {
  test('a file under the project root is passed relative to it', () => {
    const bin = '/a/proj/node_modules/mobile-automator/bin/mauto-session-daemon.js';
    expect(paths.argvPath('/a/proj', bin)).toBe(
      path.join('node_modules', 'mobile-automator', 'bin', 'mauto-session-daemon.js')
    );
  });

  test('a trailing-slash root resolves the same', () => {
    const bin = '/a/proj/node_modules/mobile-automator/bin/mauto-session-daemon.js';
    expect(paths.argvPath('/a/proj/', bin)).toBe(paths.argvPath('/a/proj', bin));
  });

  test('a file outside the root (e.g. a global install) stays absolute', () => {
    const bin = '/usr/local/lib/node_modules/mobile-automator/bin/mauto-session-daemon.js';
    expect(paths.argvPath('/a/proj', bin)).toBe(bin);
  });

  test('a sibling directory sharing the root as a prefix is outside it', () => {
    expect(paths.argvPath('/a/proj', '/a/proj2/x.js')).toBe('/a/proj2/x.js');
  });

  test('the root itself is not "under" the root', () => {
    expect(paths.argvPath('/a/proj', '/a/proj')).toBe('/a/proj');
  });

  // macOS: os.tmpdir() is under /var, a symlink to /private/var. The project
  // root may arrive as either spelling and the file as the other; comparing
  // realpaths keeps the relative form either way.
  test('a symlinked root still yields the relative form', () => {
    const real = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-argv-real-')));
    const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-argv-link-')), 'proj');
    fs.symlinkSync(real, link);
    fs.mkdirSync(path.join(real, 'bin'));
    const file = path.join(real, 'bin', 'x.js');
    fs.writeFileSync(file, '');
    try {
      expect(paths.argvPath(link, file)).toBe(path.join('bin', 'x.js'));
      expect(paths.argvPath(real, path.join(link, 'bin', 'x.js'))).toBe(path.join('bin', 'x.js'));
    } finally {
      fs.rmSync(path.dirname(link), { recursive: true, force: true });
      fs.rmSync(real, { recursive: true, force: true });
    }
  });
});
