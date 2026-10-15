'use strict';

const os = require('os');
const path = require('path');
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
// workspace. The root travels in the daemon's argv because `ps` cannot see env.
describe('daemon workspace marker (#156)', () => {
  test('daemonArgv names the resolved project root', () => {
    expect(paths.daemonArgv('/a/proj/')).toEqual(['--project-root', path.resolve('/a/proj')]);
  });

  test('commandNamesWorkspace matches the exact root at the end of the command line', () => {
    const cmd = (r) => `node /x/bin/mauto-session-daemon.js --project-root ${r}`;
    expect(paths.commandNamesWorkspace(cmd('/a/proj'), '/a/proj')).toBe(true);
    // ps output ends in a newline; a root may be spelled with a trailing slash.
    expect(paths.commandNamesWorkspace(`${cmd('/a/proj')}\n`, '/a/proj/')).toBe(true);
  });

  test('commandNamesWorkspace never matches another workspace or a bare daemon', () => {
    const cmd = (r) => `node /x/bin/mauto-session-daemon.js --project-root ${r}`;
    expect(paths.commandNamesWorkspace(cmd('/a/proj2'), '/a/proj')).toBe(false);
    expect(paths.commandNamesWorkspace(cmd('/a/proj'), '/a/pro')).toBe(false);
    expect(paths.commandNamesWorkspace(cmd('/b/a/proj'), '/a/proj')).toBe(false);
    // A pre-marker daemon, or an editor opened on the bin, names no workspace.
    expect(paths.commandNamesWorkspace('node /x/bin/mauto-session-daemon.js', '/a/proj')).toBe(false);
    expect(paths.commandNamesWorkspace('vim bin/mauto-session-daemon.js', '/a/proj')).toBe(false);
  });
});
