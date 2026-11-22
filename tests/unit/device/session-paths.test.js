'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const paths = require('../../../src/device/session-paths');

describe('session-paths', () => {
  const root = '/tmp/proj';

  test('all paths live under <root>/.mobile-automator/.session/', () => {
    const base = path.join(root, '.mobile-automator', '.session');
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

  test('logFilePath resolves to <root>/.mobile-automator/.session/daemon.log', () => {
    expect(paths.logFilePath(root)).toBe(
      path.join(root, '.mobile-automator', '.session', 'daemon.log')
    );
    expect(paths.LOG_NAME).toBe('daemon.log');
  });

  test('logFilePath stays in the workspace even where socketPath falls back to tmpdir', () => {
    // A root long enough that the in-workspace socket path exceeds the
    // sockaddr length limit. That limit is a socket-only constraint, so the
    // log file must NOT follow the socket out to os.tmpdir().
    const deepRoot = '/' + 'deeply-nested-project-dir/'.repeat(6) + 'app';
    const deps = { env: {} };
    expect(paths.socketLocation(deepRoot, deps).inWorkspace).toBe(false);
    expect(paths.socketPath(deepRoot, deps).startsWith(os.tmpdir())).toBe(true);

    expect(paths.logFilePath(deepRoot)).toBe(
      path.join(paths.sessionDir(deepRoot), 'daemon.log')
    );
  });
});

// #346: a socket in a shared directory can be planted or swapped by another
// user before the daemon binds it. The long-path fallback therefore lives in a
// per-user directory (0700, checked by session-dir.js), never directly in the
// world-writable tmpdir.
describe('socketPath fallback in a per-user directory (#346)', () => {
  const deepRoot = '/' + 'deeply-nested-project-dir/'.repeat(6) + 'app';
  const key = () => paths.workspaceKey(deepRoot);

  test('the deep root really is past the sockaddr limit, the short one is not', () => {
    expect(Buffer.byteLength(paths.workspaceSocketPath(deepRoot))).toBeGreaterThan(paths.SOCKET_PATH_LIMIT);
    expect(Buffer.byteLength(paths.workspaceSocketPath('/tmp/proj'))).toBeLessThanOrEqual(paths.SOCKET_PATH_LIMIT);
  });

  test('the fallback is <tmpdir>/mauto-<uid>/<key>.sock', () => {
    const deps = { getuid: () => 1234, tmpdir: () => '/t' };
    expect(paths.privateSocketDir(deps)).toBe(path.join('/t', 'mauto-1234'));
    expect(paths.socketPath(deepRoot, deps)).toBe(path.join('/t', 'mauto-1234', `${key()}.sock`));
    expect(path.basename(paths.socketPath(deepRoot, deps))).toMatch(/^[0-9a-f]{16}\.sock$/);
  });

  // The client and the daemon compute the fallback separately, so a second
  // ambient input would let them disagree (sudo, cron and IDEs often differ in
  // XDG_RUNTIME_DIR): the client would never find the live daemon. It is read
  // neither from the process env nor from an injected one.
  test('XDG_RUNTIME_DIR is ignored, wherever it comes from', () => {
    const had = Object.prototype.hasOwnProperty.call(process.env, 'XDG_RUNTIME_DIR');
    const prev = process.env.XDG_RUNTIME_DIR;
    process.env.XDG_RUNTIME_DIR = '/run/user/1234';
    try {
      const deps = { env: { XDG_RUNTIME_DIR: '/run/user/1234' }, getuid: () => 1234 };
      expect(paths.privateSocketDir(deps)).toBe(path.join(os.tmpdir(), 'mauto-1234'));
      expect(paths.privateSocketDir()).toBe(path.join(os.tmpdir(), `mauto-${process.getuid()}`));
      expect(paths.socketLocation(deepRoot, deps).dir).toBe(path.join(os.tmpdir(), 'mauto-1234'));
    } finally {
      if (had) process.env.XDG_RUNTIME_DIR = prev;
      else delete process.env.XDG_RUNTIME_DIR;
    }
  });

  test('a short root stays in the workspace', () => {
    const deps = { getuid: () => 1234, tmpdir: () => '/t' };
    expect(paths.socketPath('/tmp/proj', deps)).toBe(paths.workspaceSocketPath('/tmp/proj'));
  });

  test('defaults come from the real process (temp dir and uid)', () => {
    const expected = path.join(os.tmpdir(), `mauto-${process.getuid()}`);
    expect(paths.privateSocketDir()).toBe(expected);
    expect(paths.socketPath(deepRoot)).toBe(path.join(expected, `${key()}.sock`));
  });
});

// #346: one decision for where the socket lives, read by both the daemon
// (ensureSessionDirs) and the client (connectPinned), so they can never disagree.
describe('socketLocation (#346)', () => {
  const deepRoot = '/' + 'deeply-nested-project-dir/'.repeat(6) + 'app';
  const deps = { getuid: () => 1234, tmpdir: () => '/t' };
  // A root whose in-workspace socket path is exactly `bytes` long.
  const rootOfSocketBytes = (bytes) => {
    const tail = paths.workspaceSocketPath('/r').length - '/r'.length;
    return '/' + 'r'.repeat(bytes - tail - 1);
  };

  test('a short root: the socket is in .session/', () => {
    expect(paths.socketLocation('/tmp/proj', deps)).toEqual({
      file: paths.workspaceSocketPath('/tmp/proj'),
      dir: paths.sessionDir('/tmp/proj'),
      inWorkspace: true,
    });
  });

  test('a deep root: the socket is in the per-user fallback directory', () => {
    expect(paths.socketLocation(deepRoot, deps)).toEqual({
      file: path.join('/t', 'mauto-1234', `${paths.workspaceKey(deepRoot)}.sock`),
      dir: path.join('/t', 'mauto-1234'),
      inWorkspace: false,
    });
  });

  test('dir is always the directory holding file, and socketPath is file', () => {
    for (const root of ['/tmp/proj', deepRoot]) {
      const loc = paths.socketLocation(root, deps);
      expect(path.dirname(loc.file)).toBe(loc.dir);
      expect(paths.socketPath(root, deps)).toBe(loc.file);
    }
  });

  test('the limit is inclusive and counted in bytes', () => {
    const atLimit = rootOfSocketBytes(paths.SOCKET_PATH_LIMIT);
    expect(Buffer.byteLength(paths.workspaceSocketPath(atLimit))).toBe(paths.SOCKET_PATH_LIMIT);
    expect(paths.socketLocation(atLimit, deps).inWorkspace).toBe(true);
    expect(paths.socketLocation(rootOfSocketBytes(paths.SOCKET_PATH_LIMIT + 1), deps).inWorkspace).toBe(false);
    // The same character count as atLimit, but one character takes two bytes.
    const wide = '/\u00e9' + atLimit.slice(2);
    expect(wide.length).toBe(atLimit.length);
    expect(paths.socketLocation(wide, deps).inWorkspace).toBe(false);
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

  // #361: the daemon's answer to the client's hello. Pinned: a change to the
  // message format strands every running daemon, so it must be deliberate
  // (bump the v1 tag).
  test('sessionProof is HMAC-SHA256(salt, tagged real root + nonce), pinned', () => {
    const root = '/nonexistent-mauto-proof-root';
    expect(paths.sessionProof('s3cret', root, 'n0nce')).toBe(
      'fd01870555e8efc7047c05fe52ca436fe2adff378a31124e2ac9ad36b1ca56fb'
    );
    expect(paths.sessionProof('s3cret', `${root}/`, 'n0nce')).toBe(paths.sessionProof('s3cret', root, 'n0nce'));
  });

  test('sessionProof differs per salt, root and nonce', () => {
    const p = paths.sessionProof(SALT, '/a/proj', 'n');
    expect(paths.sessionProof(OTHER_SALT, '/a/proj', 'n')).not.toBe(p);
    expect(paths.sessionProof(SALT, '/a/proj2', 'n')).not.toBe(p);
    expect(paths.sessionProof(SALT, '/a/proj', 'm')).not.toBe(p);
  });

  test('sessionProof keys by realpath, so one root reached two ways agrees', () => {
    const real = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-'));
    const link = `${real}-link`;
    fs.symlinkSync(real, link);
    try {
      expect(paths.sessionProof(SALT, link, 'n')).toBe(paths.sessionProof(SALT, real, 'n'));
    } finally {
      fs.unlinkSync(link);
      fs.rmSync(real, { recursive: true, force: true });
    }
  });

  test('the salt lives in the session dir, beside daemon.pid', () => {
    expect(paths.SALT_NAME).toBe('marker.salt');
    expect(paths.saltPath('/a/proj')).toBe(path.join(paths.sessionDir('/a/proj'), 'marker.salt'));
  });

  test('the fallback socket is still named by the same, unchanged, unsalted digest', () => {
    // Salting the marker must not rename the socket: the client and the daemon
    // both derive it from the root alone, without reading the salt.
    const deepRoot = '/' + 'deeply-nested-project-dir/'.repeat(6) + 'app';
    const base = path.basename(paths.socketPath(deepRoot, { env: {}, getuid: () => 1234 }));
    expect(base).toBe(`${paths.workspaceKey(deepRoot)}.sock`);
    expect(base).toBe(`${sha16(deepRoot)}.sock`);
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
  // `session end` report the former as 'unproven' with a `kill <pid>` hint
  // (never signalled, #344) instead of as another workspace's daemon.
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
