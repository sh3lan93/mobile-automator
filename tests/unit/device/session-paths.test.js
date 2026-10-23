'use strict';

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
// workspace. #236: it names it by digest, because `ps` shows argv to every user
// on the host and a project path can name a client or project.
describe('daemon workspace marker (#156, #236)', () => {
  const sha16 = (r) => crypto.createHash('sha1').update(path.resolve(r)).digest('hex').slice(0, 16);
  const cmd = (r) => `node /x/bin/mauto-session-daemon.js ${paths.daemonArgv(r).join(' ')}`;
  const legacy = (r) => `node /x/bin/mauto-session-daemon.js --project-root ${r}`;

  test('daemonArgv names the workspace by an opaque digest, never its path', () => {
    const argv = paths.daemonArgv('/a/proj/');
    expect(argv).toHaveLength(2);
    expect(argv[0]).toBe('--workspace-key');
    expect(argv[1]).toMatch(/^[0-9a-f]{16}$/);
    expect(argv).toEqual(paths.daemonArgv('/a/proj'));
    for (const arg of argv) {
      expect(arg).not.toContain('proj');
      expect(arg).not.toContain('/a');
    }
  });

  test('the tmpdir socket fallback is still named by the same, unchanged digest', () => {
    // A running daemon is bound to this path; extracting workspaceKey must not move it.
    const deepRoot = '/' + 'deeply-nested-project-dir/'.repeat(6) + 'app';
    const base = path.basename(paths.socketPath(deepRoot));
    expect(base).toBe(`mauto-${paths.workspaceKey(deepRoot)}.sock`);
    expect(base).toBe(`mauto-${sha16(deepRoot)}.sock`);
  });

  test('commandNamesWorkspace matches this workspace\'s key at the end of the line', () => {
    expect(paths.commandNamesWorkspace(cmd('/a/proj'), '/a/proj')).toBe(true);
    // ps output ends in a newline; a root may be spelled with a trailing slash.
    expect(paths.commandNamesWorkspace(`${cmd('/a/proj')}\n`, '/a/proj/')).toBe(true);
  });

  test('commandNamesWorkspace never matches another key, a mangled key, or a bare daemon', () => {
    expect(paths.commandNamesWorkspace(cmd('/b/other'), '/a/proj')).toBe(false);
    const key = paths.workspaceKey('/a/proj');
    const line = (k) => `node /x/bin/mauto-session-daemon.js --workspace-key ${k}`;
    expect(paths.commandNamesWorkspace(line(`${key}0`), '/a/proj')).toBe(false);
    expect(paths.commandNamesWorkspace(line(key.slice(1)), '/a/proj')).toBe(false);
    // A pre-marker daemon, or an editor opened on the bin, names no workspace.
    expect(paths.commandNamesWorkspace('node /x/bin/mauto-session-daemon.js', '/a/proj')).toBe(false);
    expect(paths.commandNamesWorkspace('vim bin/mauto-session-daemon.js', '/a/proj')).toBe(false);
  });

  test('a legacy --project-root daemon (0.28.0-0.33.x) is still recognised, end-anchored', () => {
    expect(paths.LEGACY_DAEMON_ROOT_FLAG).toBe('--project-root');
    expect(paths.commandNamesWorkspace(legacy('/a/proj'), '/a/proj')).toBe(true);
    expect(paths.commandNamesWorkspace(`${legacy('/a/proj')}\n`, '/a/proj/')).toBe(true);
    expect(paths.commandNamesWorkspace(legacy('/a/proj2'), '/a/proj')).toBe(false);
    expect(paths.commandNamesWorkspace(legacy('/b/a/proj'), '/a/proj')).toBe(false);
  });
});
