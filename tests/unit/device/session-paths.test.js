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
